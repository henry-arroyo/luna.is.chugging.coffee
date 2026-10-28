#!/usr/bin/env bash
# One-time, keyless deploy access for the SOCU game. Run this yourself, in your own terminal.
#
#   1. Signs you in with `aws login` (browser, temporary credentials, no access keys).
#   2. Deploys socu-claude-access: the scoped CloudFormation execution policy + deployer role.
#   3. Bootstraps CDK in us-east-1 with its own qualifier ("socugame"), so it never touches
#      any other project's CDK bootstrap in the same account.
#   4. Confirms the deployer role can be assumed.
#
# Afterwards, deploys run through access/as-deployer.sh, which assumes the deployer role.
set -euo pipefail

ADMIN=${ADMIN_PROFILE:-socu-admin}
REGION=us-east-1
QUAL=socugame
HERE="$(cd "$(dirname "$0")" && pwd)"
INFRA="$(dirname "$HERE")"

aws configure set region "$REGION" --profile "$ADMIN"
if ! aws sts get-caller-identity --profile "$ADMIN" >/dev/null 2>&1; then
  echo "Opening the AWS sign-in page. Sign in to the account the game should live in."
  echo "(If no browser opens, rerun with: aws login --profile $ADMIN --remote)"
  aws login --profile "$ADMIN"
fi

read -r ACCOUNT ARN < <(aws sts get-caller-identity --profile "$ADMIN" --query '[Account,Arn]' --output text)
ALIAS=$(aws iam list-account-aliases --profile "$ADMIN" --query 'AccountAliases[0]' --output text 2>/dev/null || true)

if [[ "$ARN" == *":root" ]]; then
  echo "You're signed in as the root user. AWS doesn't let root assume roles, so the deployer role"
  echo "can't work from this session. Sign in as an IAM user (or IAM Identity Center user) with admin"
  echo "rights instead, then rerun:  aws logout --profile $ADMIN && $0"
  exit 1
fi

echo
echo "  Account:   $ACCOUNT ${ALIAS:+($ALIAS)}"
echo "  Signed in: $ARN"
echo "  Region:    $REGION"
echo
echo "This creates: IAM role socu-claude-deployer, IAM policy socu-cdk-execution,"
echo "and CDK bootstrap stack CDKToolkit-$QUAL."
read -rp "Type the account ID to confirm: " CONFIRM
[[ "$CONFIRM" == "$ACCOUNT" ]] || { echo "Account ID didn't match. Nothing was changed."; exit 1; }

echo "== Deploying socu-claude-access"
aws cloudformation deploy --profile "$ADMIN" --region "$REGION" \
  --stack-name socu-claude-access \
  --template-file "$HERE/deployer-access.yaml" \
  --parameter-overrides "Qualifier=$QUAL" \
  --capabilities CAPABILITY_NAMED_IAM \
  --tags project=mcfcu-socu-training \
  --no-fail-on-empty-changeset

POLICY_ARN=$(aws cloudformation describe-stacks --profile "$ADMIN" --region "$REGION" --stack-name socu-claude-access \
  --query "Stacks[0].Outputs[?OutputKey=='ExecutionPolicyArn'].OutputValue" --output text)

echo "== Bootstrapping CDK (qualifier $QUAL)"
[[ -d "$INFRA/node_modules" ]] || (cd "$INFRA" && npm ci --no-audit --no-fund)
(
  # Short-lived env credentials from the login session, so any SDK version can use them.
  eval "$(aws configure export-credentials --profile "$ADMIN" --format env)"
  cd "$INFRA"
  npx cdk bootstrap "aws://$ACCOUNT/$REGION" \
    --qualifier "$QUAL" \
    --toolkit-stack-name "CDKToolkit-$QUAL" \
    --cloudformation-execution-policies "$POLICY_ARN" \
    --tags project=mcfcu-socu-training
)

echo "== Checking the deployer role"
"$HERE/as-deployer.sh" aws sts get-caller-identity --query Arn --output text

echo
echo "Done. Hand off to Claude Code. Your login session (profile $ADMIN) is the only credential;"
echo "it expires on its own (max 12 h). To cut access early:  aws logout --profile $ADMIN"
