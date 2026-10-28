import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

export interface CertStackProps extends cdk.StackProps {
  domainName: string;
}

/**
 * ACM certificate for the game's custom domain.
 *
 * DNS is hosted in Cloudflare, so validation is manual: while this stack is deploying,
 * CloudFormation waits until the validation CNAME exists. Get the record with:
 *
 *   aws acm list-certificates --region us-east-1
 *   aws acm describe-certificate --region us-east-1 --certificate-arn <arn> \
 *     --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
 *
 * Add it in Cloudflare as a DNS-only (grey cloud) CNAME. Keep this stack deployed
 * between sessions so you only do this once.
 */
export class CertStack extends cdk.Stack {
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertStackProps) {
    super(scope, id, props);

    const cert = new acm.Certificate(this, 'Certificate', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(),
    });
    cert.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    this.certificate = cert;

    new cdk.CfnOutput(this, 'CertificateArn', { value: cert.certificateArn });
  }
}
