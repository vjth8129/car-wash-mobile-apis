#!/usr/bin/env bash
# Creates a new environment's AWS stack, or applies changed settings to an existing one.
#
#   scripts/create-stack.sh <env>
#
# Reads deploy/aws/params/<env>.env and creates/updates CloudFormation stack "vahanly-<env>"
# (VPC, EC2 + Elastic IP, RDS Postgres, secrets, deploy bucket). It only builds the
# infrastructure - ship the code to it with scripts/deploy.sh <env>.
#
# New environment, start to finish:
#   cp deploy/aws/params/uat.env deploy/aws/params/prod.env    # then edit it
#   AWS_PROFILE=company scripts/create-stack.sh prod
#   AWS_PROFILE=company scripts/deploy.sh prod

set -euo pipefail
ENV_NAME="${1:-}"
# shellcheck source=lib/aws-stack.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/aws-stack.sh"
require_env_name

# A restored snapshot keeps the source database's password; switch it to the one in the
# stack's DB secret (what the API is configured with). Recorded with a tag so it runs once.
sync_restored_db_password() {
  [ "$(output RestoredFromSnapshot)" = "true" ] || return 0
  local db_id db_arn
  db_id="$(output DbInstanceId)"
  db_arn="$(aws rds describe-db-instances --db-instance-identifier "$db_id" --query 'DBInstances[0].DBInstanceArn' --output text)"
  if [ "$(aws rds list-tags-for-resource --resource-name "$db_arn" \
        --query "TagList[?Key=='vahanly:password-synced'].Value" --output text)" = "true" ]; then
    return 0
  fi
  log "Switching the restored database to the stack's password"
  aws rds modify-db-instance --db-instance-identifier "$db_id" --apply-immediately \
    --master-user-password "$(aws secretsmanager get-secret-value --secret-id "$(output DbSecretArn)" \
      --query SecretString --output text | jq -r .password)" > /dev/null
  sleep 30
  aws rds wait db-instance-available --db-instance-identifier "$db_id"
  aws rds add-tags-to-resource --resource-name "$db_arn" --tags Key=vahanly:password-synced,Value=true
}

params_file="$REPO_ROOT/deploy/aws/params/$ENV_NAME.env"
[ -f "$params_file" ] || die "missing $params_file - copy deploy/aws/params/uat.env and edit it"

overrides=("EnvName=$ENV_NAME")
while IFS= read -r line; do
  # Skip comments, blank lines and empty values (the template defaults those to blank).
  [[ "$line" =~ ^[[:space:]]*(#|$) || "$line" =~ =$ ]] && continue
  overrides+=("$line")
done < "$params_file"

if stack_exists; then
  log "Updating stack $STACK in $AWS_REGION"
else
  log "Creating stack $STACK in $AWS_REGION (~10-15 min, mostly the database)"
fi
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --tags "app=vahanly" "env=$ENV_NAME" \
  --parameter-overrides "${overrides[@]}" \
  || die "stack $STACK failed - see: aws cloudformation describe-stack-events --stack-name $STACK"

sync_restored_db_password
print_outputs
echo
echo "Next: scripts/deploy.sh $ENV_NAME"
