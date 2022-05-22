import { Construct } from "constructs";
import { App, Fn, TerraformOutput, TerraformStack, Token } from "cdktf";
import { AwsProvider, ec2, vpc } from "@cdktf/provider-aws";
import { TlsProvider, PrivateKey } from "@cdktf/provider-tls";
import { writeFileSync } from "fs";

class MyStack extends TerraformStack {

  ingressPorts: number[] = [22, 80, 443];

  constructor(
    scope: Construct, name: string, profile: string = "k8s-admin",
    region: string = "us-east-2", availabilityZone: string = "us-east-2a"
  ) {
    super(scope, name);

    // define resources here
    // create new TLS provider
    new TlsProvider(this, "tls-provider", {});
    // configure AWS provider
    new AwsProvider(this, "aws", {
      region: region,
      sharedConfigFiles: ["~/.aws/config"],
      sharedCredentialsFiles: ["~/.aws/credentials"],
      profile: profile
    });

    // const amis = ec2.dataAwsAmiIdsFilterToTerraform({
    //   name: "name",
    //   values: ["amzn-ami-hvm-*"]
    // });
    // console.log(amis);

    // get AMI from AWS
    const amis = new ec2.DataAwsAmiIds(this, "ami-ids", {
      owners: ["amazon"],
      // nameRegex: "^amzn2-ami-hvm-*-x86_64-ebs",
      filter: [{
        name: "name",
        values: ["amzn2-ami-hvm-*-x86_64-ebs"]
      }]
    });

    // create a private key
    const privateKey = new PrivateKey(this, "private-key", {
      algorithm: "RSA",
      rsaBits: 4096
    });
    // get output from private key

    // create AWS key pair, await
    const keyPair = new ec2.KeyPair(this, "key-pair", {
        keyName: "my-key-pair",
        publicKey: Token.asString(privateKey.publicKeyOpenssh)
    });

    // save the private key to a local file (local_sensitive_file)
    // TODO: this saves the key as a TOKEN, not the actual key
    writeFileSync("id_rsa", Fn.tostring(privateKey.privateKeyOpenssh));

    // create a VPC
    const terraformVpc = new vpc.Vpc(this, "vpc", {
      cidrBlock: "10.0.0.0/16",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      tags: {
        Name: "terraform-vpc"
      }
    });

    // create a (public) subnet
    const publicSubnet = new vpc.Subnet(this, "public-subnet", {
      availabilityZone: availabilityZone,
      cidrBlock: "10.0.1.0/24",
      vpcId: terraformVpc.id,
      tags: {
        Name: "terraform-public-subnet"
      }
    });

    // create an internet gateway
    const internetGateway = new vpc.InternetGateway(this, "internet-gateway", {
      tags: {
        Name: "terraform-internet-gateway"
      },
      vpcId: terraformVpc.id
    });

    // create route table
    const routeTable = new vpc.RouteTable(this, "route-table", {
      vpcId: terraformVpc.id,
      tags: {
        Name: "terraform-route-table"
      },
      route: [{
        cidrBlock: "0.0.0.0/0",
        gatewayId: internetGateway.id
      }]
    });

    // create a route table association
    new vpc.RouteTableAssociation(this, "route-table-association", {
      routeTableId: routeTable.id,
      subnetId: publicSubnet.id
    });

    // create a security group to allow SSH access
    const securityGroup = new vpc.SecurityGroup(this, "security-group", {
      vpcId: terraformVpc.id,
      description: "Allow SSH and web access",
      // loop over ingressPorts
      ingress: this.ingressPorts.map(port => {
        return {
          fromPort: port,
          toPort: port,
          protocol: "tcp",
          cidrBlocks: ["0.0.0.0/0"],
          ipv6CidrBlocks: ["::/0"]
        };
      }),
      egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"]
      }],
      tags: {
        Name: "terraform-security-group"
      }
    });

    // now create the EC2 instance
    const instance = new ec2.Instance(this, "instance", {
      instanceType: "t2.micro",
      ami: Fn.element(amis.ids, 0).toString(), // "ami-0fa49cc9dc8d62c84", //amis[0],
      keyName: keyPair.keyName,
      vpcSecurityGroupIds: [securityGroup.id],
      subnetId: publicSubnet.id,
      tags: {
        Name: "terraform-instance"
      },
      associatePublicIpAddress: true
    });

    // create some outputs
    new TerraformOutput(this, "public_ip", {
      value: instance.publicIp,
    });

    // new TerraformOutput(this, "private_key", {
    //   value: privateKey.privateKeyOpenssh,
    //   sensitive: true
    // });

  }
}

const app = new App();
new MyStack(app, "cdk-ec2");
app.synth();
