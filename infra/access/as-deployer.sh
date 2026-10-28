#!/usr/bin/env bash
# Run a command as the socu-claude-deployer role, with temporary credentials (1 hour). No access keys.
#
#   access/as-deployer.sh npm run deploy:site
#   access/as-deployer.sh npx cdk deploy SocuGame-Game --require-approval never
#
# The source session is your `aws login` profile (socu-admin by default; set up by setup-access.sh).
set -euo pipefail

ADMIN=${ADMIN_PROFILE:-socu-admin}
ACCOUNT=$(aws sts get-caller-identity --profile "$ADMIN" --query Account --output text)
read -r AK SK ST < <(aws sts assume-role --profile "$ADMIN" \
  --role-arn "arn:aws:iam::$ACCOUNT:role/socu-claude-deployer" \
  --role-session-name claude-code-socu \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)

unset AWS_PROFILE AWS_DEFAULT_PROFILE
export AWS_ACCESS_KEY_ID="$AK" AWS_SECRET_ACCESS_KEY="$SK" AWS_SESSION_TOKEN="$ST"
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1 CDK_DEFAULT_ACCOUNT="$ACCOUNT"
exec "$@"
