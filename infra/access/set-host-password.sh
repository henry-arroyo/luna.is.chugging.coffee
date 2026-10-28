#!/usr/bin/env bash
# Set or change the host (TV) password. Run this yourself, in your own terminal.
#
#   access/set-host-password.sh
#
# Stores only a salted scrypt hash, in SSM Parameter Store at /socugame/host-password-hash.
# The parameter lives outside every stack, so it survives teardowns and redeploys.
# A change takes effect within about 5 minutes, with no redeploy.
set -euo pipefail

ADMIN=${ADMIN_PROFILE:-socu-admin}
PARAM=/socugame/host-password-hash
INFRA="$(cd "$(dirname "$0")/.." && pwd)"

read -rsp "New host password (8 or more characters): " PW; echo
read -rsp "Type it again: " PW2; echo
[[ "$PW" == "$PW2" ]] || { echo "The two entries didn't match. Nothing was changed."; exit 1; }
(( ${#PW} >= 8 && ${#PW} <= 128 )) || { echo "Use 8 to 128 characters. Nothing was changed."; exit 1; }

# The password goes to node on stdin, so it never appears in a process list or shell history.
HASH=$(printf '%s' "$PW" | node -e "
  const { hashPassword } = require(process.argv[1]);
  let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => process.stdout.write(hashPassword(s)));
" "$INFRA/lambda/auth-core.js")
unset PW PW2

aws ssm put-parameter --profile "$ADMIN" --region us-east-1 \
  --name "$PARAM" --type String --overwrite \
  --description "SOCU game host password (scrypt hash; set with access/set-host-password.sh)" \
  --value "$HASH" >/dev/null
echo "Host password saved (as a hash) in $PARAM."
