import { Construct } from "constructs";
import { App, TerraformOutput, TerraformStack } from "cdktf";
import { AwsProvider, ec2, vpc } from "@cdktf/provider-aws";
import { PrivateKey } from "@cdktf/provider-tls";
import { writeFileSync } from "fs";

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);

    // define resources here
    // configure AWS provider
    new AwsProvider(this, "aws", {
      region: "us-east-2",
      sharedConfigFiles: ["~/.aws/config"],
      sharedCredentialsFiles: ["~/.aws/credentials"],
      profile: "k8s-admin"
    });

    // create a private key
    const privateKey = new PrivateKey(this, "private-key", {
      algorithm: "RSA",
      rsaBits: 4096
    });

    // create AWS key pair
    const keyPair = new ec2.KeyPair(this, "key-pair", {
        keyName: "my-key-pair",
        publicKey: privateKey.publicKeyOpenssh
    });

    // save the private key to a local file (local_sensitive_file)
    writeFileSync("id_rsa", privateKey.privateKeyOpenssh);

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
      availabilityZone: "us-east-2a",
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
      description: "Allow SSH access",
      ingress: [{
        fromPort: 22,
        toPort: 22,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"]
      }],
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
      ami: "ami-0b9e9e9e",
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

  }
}

const app = new App();
new MyStack(app, "cdk-ec2");
app.synth();
