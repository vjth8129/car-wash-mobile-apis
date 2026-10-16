#!/usr/bin/env bash
# Ships the current code to an environment: this repo's API, plus the super admin portal
# (built from ADMIN_DIR, default ../car-wash-admin).
#
#   scripts/deploy.sh <env> [--seed] [--no-admin]
#
#   --seed       also load the demo data (UAT only - it creates demo users with known passwords)
#   --no-admin   ship only the API, leaving the deployed admin portal as is
#
# e.g. AWS_PROFILE=company scripts/deploy.sh uat
#
# The stack must already exist (scripts/create-stack.sh <env>). The bundle goes to the stack's
# S3 bucket and deploy/aws/remote-deploy.sh runs on the instance via SSM - no SSH involved.
# It rebuilds the image, runs migrations, restarts the API and publishes the admin portal.

set -euo pipefail
ENV_NAME="${1:-}"
[ $# -gt 0 ] && shift
# shellcheck source=lib/aws-stack.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/aws-stack.sh"
require_env_name

ADMIN_DIR="${ADMIN_DIR:-$REPO_ROOT/../car-wash-admin}"
seed_flag=""
with_admin=true
for arg in "$@"; do
  case "$arg" in
    --seed) seed_flag="--seed" ;;
    --no-admin) with_admin=false ;;
    *) die "unknown flag $arg" ;;
  esac
done
stack_exists || die "stack $STACK doesn't exist - create it first: scripts/create-stack.sh $ENV_NAME"

wait_for_ssm() {
  for _ in $(seq 1 60); do
    if [ "$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$1" \
          --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)" = "Online" ]; then
      return 0
    fi
    sleep 10
  done
  die "$1 never showed up in SSM (is the instance running? check its system log)"
}

work="$(mktemp -d -t vahanly-deploy-XXXXXX)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bundle/api"

log "Packaging the API ($(git -C "$REPO_ROOT" rev-parse --short HEAD)$(git -C "$REPO_ROOT" diff --quiet || echo ', with uncommitted changes'))"
# Never ship a local .env or .deploy/ - the server writes its own .env from Secrets Manager.
tar --exclude='./node_modules' --exclude='./dist' --exclude='./.git' --exclude='./coverage' \
  --exclude='./.env' --exclude='./.env.*' --exclude='./.deploy' \
  -C "$REPO_ROOT" -cf - . | tar -C "$work/bundle/api" -xf -
cp "$REPO_ROOT/deploy/aws/remote-deploy.sh" "$work/bundle/"

if [ "$with_admin" = true ]; then
  [ -d "$ADMIN_DIR" ] || die "admin portal not found at $ADMIN_DIR (set ADMIN_DIR, or pass --no-admin)"
  log "Building the admin portal ($ADMIN_DIR)"
  ( cd "$ADMIN_DIR" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build ) > "$work/admin-build.log" 2>&1 \
    || { cat "$work/admin-build.log"; die "admin portal build failed"; }
  cp -a "$ADMIN_DIR/dist" "$work/bundle/admin"
fi

bundle="$work/bundle.tar.gz"
tar -C "$work/bundle" -czf "$bundle" .
bucket="$(output ArtifactBucket)"
key="bundles/$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$REPO_ROOT" rev-parse --short HEAD).tar.gz"
log "Uploading bundle ($(du -h "$bundle" | cut -f1)) to s3://$bucket/$key"
aws s3 cp --only-show-errors "$bundle" "s3://$bucket/$key"

instance_id="$(output InstanceId)"
wait_for_ssm "$instance_id"

log "Running the deploy on $instance_id"
# SSM runs this with /bin/sh (dash) - keep it POSIX; remote-deploy.sh itself is bash.
# On a brand-new instance, SSM comes online before first-boot setup (aws-cli, docker) is done.
remote="set -eu; cloud-init status --wait > /dev/null || true; export PATH=\$PATH:/snap/bin; d=\$(mktemp -d); trap 'rm -rf \$d' EXIT; aws s3 cp --only-show-errors s3://$bucket/$key \$d/b.tgz; tar -xzf \$d/b.tgz -C \$d; bash \$d/remote-deploy.sh $seed_flag"
command_id="$(aws ssm send-command --instance-ids "$instance_id" --document-name AWS-RunShellScript \
  --comment "vahanly deploy $key" --timeout-seconds 600 \
  --parameters "$(jq -n --arg c "$remote" '{commands: [$c], executionTimeout: ["3600"]}')" \
  --query Command.CommandId --output text)"

while :; do
  sleep 10
  status="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
    --query Status --output text 2>/dev/null || echo Pending)"
  case "$status" in
    Pending|InProgress|Delayed) printf '.' ;;
    *) echo; break ;;
  esac
done

# SSM keeps the last ~24 KB of each stream - enough for the summary lines.
aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
  --query StandardOutputContent --output text | grep -E '^==>|"status"|WARNING' || true
if [ "$status" != "Success" ]; then
  aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
    --query StandardErrorContent --output text | tail -40
  die "deploy $status (command $command_id)"
fi
log "Deployed $key to $STACK"
