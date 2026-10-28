#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CertStack } from '../lib/cert-stack';
import { SiteStack } from '../lib/site-stack';
import { GameStack } from '../lib/game-stack';

/**
 * MCFCU SOCU training game.
 *
 *   SocuGame-Cert  (persistent) ACM certificate for the custom domain. DNS-validated in Cloudflare once.
 *   SocuGame-Site  (persistent) Private S3 bucket + CloudFront (OAC, security headers). CNAME set in Cloudflare once.
 *   SocuGame-Game  (ephemeral)  AppSync Events API, "game" namespace, 48-hour API key, runtime config.json.
 *
 * Everything lives in us-east-1 because CloudFront requires its certificate there,
 * and keeping one region avoids cross-region references.
 */
const app = new cdk.App();

const domainName: string = app.node.tryGetContext('domainName') ?? 'luna.is.chugging.coffee';
const keyHours = Number(app.node.tryGetContext('apiKeyHours') ?? 48);

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' };

const cert = new CertStack(app, 'SocuGame-Cert', { env, domainName });

const site = new SiteStack(app, 'SocuGame-Site', {
  env,
  domainName,
  certificate: cert.certificate,
});

new GameStack(app, 'SocuGame-Game', {
  env,
  bucket: site.bucket,
  distribution: site.distribution,
  apiKeyHours: keyHours,
});

cdk.Tags.of(app).add('project', 'mcfcu-socu-training');
cdk.Tags.of(app).add('owner', 'harroyo');
