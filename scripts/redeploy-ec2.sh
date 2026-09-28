#!/usr/bin/env bash
# Redeploys the current working tree to the EC2 instance:
#   1. Packages the repo (excluding node_modules/dist/.git/coverage)
#   2. Copies it to the instance, keeping the existing .env in place
#   3. Rebuilds and restarts the api container via docker-compose.prod.yml
#
# Usage:
#   SSH_KEY=~/carwash-deploy-key.pem ./scripts/redeploy-ec2.sh
#   SSH_KEY=~/carwash-deploy-key.pem EC2_HOST=3-110-172-236.nip.io ./scripts/redeploy-ec2.sh --migrate
#
#   # No .pem? Use EC2 Instance Connect with your AWS CLI credentials instead:
#   EC2_INSTANCE_ID=i-08c2b6c26f77abbd8 ./scripts/redeploy-ec2.sh --migrate
#
# Env vars (defaults are for this deployment):
#   SSH_KEY         - path to the carwash-deploy-key.pem private key
#   EC2_INSTANCE_ID - instead of SSH_KEY: push a throwaway key via EC2 Instance Connect
#                     (needs `aws` configured with ec2-instance-connect:SendSSHPublicKey)
#   EC2_HOST        - instance hostname/IP to connect to (default: 3-110-172-236.nip.io)
#   EC2_USER        - SSH user (default: ubuntu)
#
# All SSH/SCP calls share one multiplexed connection, so an Instance Connect key
# (valid for 60s) only has to be good for the first connection.
#
# Pass --migrate to also run `node dist/db/migrate.js` (with the new image, before
# the restart) - needed when this deploy includes new migration files.

set -euo pipefail

EC2_HOST="${EC2_HOST:-3-110-172-236.nip.io}"
EC2_USER="${EC2_USER:-ubuntu}"
EC2_INSTANCE_ID="${EC2_INSTANCE_ID:-}"
SSH_KEY="${SSH_KEY:-}"
REMOTE_DIR="car-wash-apis"
RUN_MIGRATE=false

if [ -z "$SSH_KEY" ] && [ -z "$EC2_INSTANCE_ID" ]; then
  echo "Set SSH_KEY to the path of carwash-deploy-key.pem, or EC2_INSTANCE_ID to use EC2 Instance Connect" >&2
  exit 1
fi

for arg in "$@"; do
  [ "$arg" = "--migrate" ] && RUN_MIGRATE=true
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="$(mktemp -t carwash-app-XXXXXX.tar.gz)"
WORK_DIR="$(mktemp -d -t carwash-deploy-XXXXXX)"
CONTROL_PATH="$WORK_DIR/cm.sock"

cleanup() {
  ssh -o ControlPath="$CONTROL_PATH" -O exit "$EC2_USER@$EC2_HOST" 2>/dev/null || true
  rm -rf "$ARCHIVE" "$WORK_DIR"
}
trap cleanup EXIT

echo "==> Packaging $REPO_ROOT"
tar --exclude='node_modules' --exclude='dist' --exclude='.git' --exclude='coverage' \
  -czf "$ARCHIVE" -C "$REPO_ROOT" .

if [ -z "$SSH_KEY" ]; then
  echo "==> Pushing a temporary key via EC2 Instance Connect ($EC2_INSTANCE_ID)"
  SSH_KEY="$WORK_DIR/eic_key"
  ssh-keygen -q -t ed25519 -N '' -f "$SSH_KEY" -C "redeploy-$(date +%s)"
  aws ec2-instance-connect send-ssh-public-key \
    --instance-id "$EC2_INSTANCE_ID" \
    --instance-os-user "$EC2_USER" \
    --ssh-public-key "file://$SSH_KEY.pub" >/dev/null
fi

SSH_OPTS="-o StrictHostKeyChecking=no -o ControlMaster=auto -o ControlPath=$CONTROL_PATH -o ControlPersist=15m -i $SSH_KEY"
SSH="ssh $SSH_OPTS $EC2_USER@$EC2_HOST"
SCP="scp $SSH_OPTS"

echo "==> Connecting to $EC2_HOST"
# Open the shared connection now, while an Instance Connect key is still valid.
ssh $SSH_OPTS -fN "$EC2_USER@$EC2_HOST"

echo "==> Uploading"
$SCP "$ARCHIVE" "$EC2_USER@$EC2_HOST:/home/$EC2_USER/app-deploy.tar.gz"

echo "==> Extracting (preserving existing .env) and rebuilding"
$SSH bash -s << REMOTE
set -euo pipefail
rm -rf ${REMOTE_DIR}-new
mkdir ${REMOTE_DIR}-new
tar -xzf app-deploy.tar.gz -C ${REMOTE_DIR}-new
rm -f app-deploy.tar.gz
if [ -f ${REMOTE_DIR}/.env ]; then
  cp ${REMOTE_DIR}/.env ${REMOTE_DIR}-new/.env
fi
rm -rf ${REMOTE_DIR}-old
[ -d ${REMOTE_DIR} ] && mv ${REMOTE_DIR} ${REMOTE_DIR}-old
mv ${REMOTE_DIR}-new ${REMOTE_DIR}
rm -rf ${REMOTE_DIR}-old
cd ${REMOTE_DIR}
sudo docker compose -f docker-compose.prod.yml build
if [ "${RUN_MIGRATE}" = true ]; then
  # Migrate with the new image *before* swapping containers: migrations are additive,
  # so the old code keeps working against the new schema until the restart.
  echo "==> Running migrations"
  sudo docker compose -f docker-compose.prod.yml run --rm -T api node dist/db/migrate.js
fi
sudo docker compose -f docker-compose.prod.yml up -d
REMOTE

echo "==> Health check"
$SSH "curl -sf --retry 10 --retry-delay 2 --retry-all-errors http://127.0.0.1:5000/health && echo"

echo "==> Done. https://$EC2_HOST/api/docs"
