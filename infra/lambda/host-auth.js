// AppSync Events Lambda authorizer for the host (TV). The token is the host password.
// It's the only way to publish on /down/<CODE> or subscribe to /up/<CODE>.
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { makeHandler } = require('./auth-core');

const ssm = new SSMClient({});

exports.handler = makeHandler(async () => {
  const out = await ssm.send(new GetParameterCommand({ Name: process.env.HASH_PARAM }));
  return out.Parameter.Value;
});
