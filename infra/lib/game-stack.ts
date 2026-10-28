import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface GameStackProps extends cdk.StackProps {
  bucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
  apiKeyHours: number;
}

/**
 * onPublish guard for both namespaces (APPSYNC_JS runtime).
 *  - Only /up/<CODE> and /down/<CODE> channels are accepted.
 *  - Each event must be an object with a string "t" (message type) and stay small.
 * Anything else is dropped rather than broadcast.
 */
const HANDLER_CODE = `
export function onPublish(ctx) {
  if (ctx.info.channel.segments.length !== 2) {
    return [];
  }
  return ctx.events.filter((e) => {
    const p = e.payload;
    if (p === null || typeof p !== 'object' || typeof p.t !== 'string') {
      return false;
    }
    return JSON.stringify(p).length <= 60000;
  });
}
`;

/**
 * Real-time layer. Destroy this stack between sessions:
 * it removes the API, invalidates the key, and deletes /runtime/config.json.
 *
 * Two namespaces with opposite rules, so the public API key can't stand in for the TV:
 *   /up/<CODE>    phones -> TV. Publish: API key. Subscribe: host password only.
 *   /down/<CODE>  TV -> phones. Publish: host password only. Subscribe: API key.
 * The host password is checked by a Lambda authorizer against a hash in SSM Parameter Store
 * (set with access/set-host-password.sh; it lives outside every stack).
 */
export class GameStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GameStackProps) {
    super(scope, id, props);

    const hashParam: string = this.node.tryGetContext('hostPasswordParam') ?? '/socugame/host-password-hash';
    const hostAuth = new lambda.Function(this, 'HostAuth', {
      description: 'SOCU game: checks the host (TV) password for AppSync Events',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'host-auth.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      memorySize: 256, // scrypt is CPU-bound; more memory means more CPU
      timeout: cdk.Duration.seconds(5),
      environment: { HASH_PARAM: hashParam },
    });
    hostAuth.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: hashParam.replace(/^\//, '') })],
    }));

    const KEY = appsync.AppSyncAuthorizationType.API_KEY;
    const HOST = appsync.AppSyncAuthorizationType.LAMBDA;
    const api = new appsync.EventApi(this, 'EventApi', {
      apiName: 'mcfcu-socu-game',
      authorizationConfig: {
        authProviders: [
          {
            authorizationType: appsync.AppSyncAuthorizationType.API_KEY,
            apiKeyConfig: {
              description: `SOCU game key (${props.apiKeyHours}h)`,
              expires: cdk.Expiration.after(cdk.Duration.hours(props.apiKeyHours)),
            },
          },
          {
            authorizationType: HOST,
            lambdaAuthorizerConfig: {
              handler: hostAuth,
              resultsCacheTtl: cdk.Duration.minutes(5),
              validationRegex: '^.{8,128}$',
            },
          },
        ],
        // Everyone connects with the API key; the password is only checked on the host's own operations.
        connectionAuthModeTypes: [KEY],
        defaultPublishAuthModeTypes: [KEY],
        defaultSubscribeAuthModeTypes: [KEY],
      },
      logConfig: {
        fieldLogLevel: appsync.AppSyncFieldLogLevel.ERROR,
        retention: logs.RetentionDays.ONE_WEEK,
      },
    });

    // Escape hatch: `cdk deploy SocuGame-Game -c publishGuard=false` deploys the namespaces
    // without the onPublish handler if the handler ever misbehaves.
    const guard = this.node.tryGetContext('publishGuard') !== 'false';
    const namespace = (name: string, publish: appsync.AppSyncAuthorizationType, subscribe: appsync.AppSyncAuthorizationType) =>
      api.addChannelNamespace(name, {
        channelNamespaceName: name,
        authorizationConfig: { publishAuthModeTypes: [publish], subscribeAuthModeTypes: [subscribe] },
        ...(guard ? { code: appsync.Code.fromInline(HANDLER_CODE) } : {}),
      });
    namespace('up', KEY, HOST);
    namespace('down', HOST, KEY);

    const apiKey = api.apiKeys['Default'].attrApiKey;
    const expiresAt = new Date(Date.now() + props.apiKeyHours * 3600 * 1000).toISOString();

    new s3deploy.BucketDeployment(this, 'RuntimeConfig', {
      sources: [
        s3deploy.Source.jsonData('config.json', {
          mode: 'appsync',
          realtimeDomain: api.realtimeDns,
          httpDomain: api.httpDns,
          apiKey,
          keyExpiresApprox: expiresAt,
        }),
      ],
      destinationBucket: props.bucket,
      destinationKeyPrefix: 'runtime/',
      prune: false,
      retainOnDelete: false, // stack delete removes runtime/ -> site shows "game offline"
      cacheControl: [s3deploy.CacheControl.noStore()],
      distribution: props.distribution,
      distributionPaths: ['/runtime/*'],
    });

    new cdk.CfnOutput(this, 'RealtimeEndpoint', { value: `wss://${api.realtimeDns}/event/realtime` });
    new cdk.CfnOutput(this, 'HttpEndpoint', { value: `https://${api.httpDns}/event` });
    new cdk.CfnOutput(this, 'ApiKeyExpiresApprox', { value: expiresAt });
  }
}
