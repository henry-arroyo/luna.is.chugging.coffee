import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
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
 * onPublish guard for the "game" namespace (APPSYNC_JS runtime).
 *  - Only /game/<CODE>/up and /game/<CODE>/down channels are accepted.
 *  - Each event must be an object with a string "t" (message type) and stay small.
 * Anything else is dropped rather than broadcast.
 */
const HANDLER_CODE = `
export function onPublish(ctx) {
  const segs = ctx.info.channel.segments;
  const last = segs[segs.length - 1];
  if (last !== 'up' && last !== 'down') {
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
 */
export class GameStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GameStackProps) {
    super(scope, id, props);

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
        ],
      },
      logConfig: {
        fieldLogLevel: appsync.AppSyncFieldLogLevel.ERROR,
        retention: logs.RetentionDays.ONE_WEEK,
      },
    });

    // Escape hatch: `cdk deploy SocuGame-Game -c publishGuard=false` deploys the namespace
    // without the onPublish handler if the handler ever misbehaves.
    const guard = this.node.tryGetContext('publishGuard') !== 'false';
    api.addChannelNamespace('game', {
      channelNamespaceName: 'game',
      ...(guard ? { code: appsync.Code.fromInline(HANDLER_CODE) } : {}),
    });

    const apiKey = api.apiKeys['Default'].attrApiKey;
    const expiresAt = new Date(Date.now() + props.apiKeyHours * 3600 * 1000).toISOString();

    new s3deploy.BucketDeployment(this, 'RuntimeConfig', {
      sources: [
        s3deploy.Source.jsonData('config.json', {
          mode: 'appsync',
          realtimeDomain: api.realtimeDns,
          httpDomain: api.httpDns,
          apiKey,
          namespace: 'game',
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
