#!/usr/bin/env bash
# Tears an environment down: deletes CloudFormation stack "vahanly-<env>" and everything in it.
# The database takes a final snapshot first (named after the stack, kept until you delete it).
#
#   scripts/delete-stack.sh <env>
#
# Asks you to type the env name to confirm. Prod's database has deletion protection on -
# turn DBDeletionProtection off in its params file and run create-stack.sh first.

set -euo pipefail
ENV_NAME="${1:-}"
# shellcheck source=lib/aws-stack.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/aws-stack.sh"
require_env_name

stack_exists || die "stack $STACK doesn't exist"
print_outputs
read -r -p "Delete stack $STACK and everything above? Type '$ENV_NAME' to confirm: " answer
[ "$answer" = "$ENV_NAME" ] || die "not confirmed"

bucket="$(output ArtifactBucket)"
log "Emptying s3://$bucket"
aws s3 rm --only-show-errors --recursive "s3://$bucket" || true
log "Deleting $STACK (~10 min)"
aws cloudformation delete-stack --stack-name "$STACK"
aws cloudformation wait stack-delete-complete --stack-name "$STACK" \
  || die "delete failed - see: aws cloudformation describe-stack-events --stack-name $STACK"
log "Deleted $STACK"
