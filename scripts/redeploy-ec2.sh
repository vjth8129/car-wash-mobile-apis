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
# Env vars (all but SSH_KEY have defaults for this deployment):
#   SSH_KEY   - path to the carwash-deploy-key.pem private key (required)
#   EC2_HOST  - instance hostname/IP to connect to (default: 3-110-172-236.nip.io)
#   EC2_USER  - SSH user (default: ubuntu)
#
# Pass --migrate to also run `node dist/db/migrate.js` after the restart
# (only needed when this deploy includes new migration files).

set -euo pipefail

SSH_KEY="${SSH_KEY:?Set SSH_KEY to the path of carwash-deploy-key.pem}"
EC2_HOST="${EC2_HOST:-3-110-172-236.nip.io}"
EC2_USER="${EC2_USER:-ubuntu}"
REMOTE_DIR="car-wash-apis"
RUN_MIGRATE=false

for arg in "$@"; do
  [ "$arg" = "--migrate" ] && RUN_MIGRATE=true
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="$(mktemp -t carwash-app-XXXXXX.tar.gz)"
trap 'rm -f "$ARCHIVE"' EXIT

echo "==> Packaging $REPO_ROOT"
tar --exclude='node_modules' --exclude='dist' --exclude='.git' --exclude='coverage' \
  -czf "$ARCHIVE" -C "$REPO_ROOT" .

SSH="ssh -o StrictHostKeyChecking=no -i $SSH_KEY $EC2_USER@$EC2_HOST"
SCP="scp -o StrictHostKeyChecking=no -i $SSH_KEY"

echo "==> Uploading to $EC2_HOST"
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
sudo docker compose -f docker-compose.prod.yml up -d --build
REMOTE

if [ "$RUN_MIGRATE" = true ]; then
  echo "==> Running migrations"
  $SSH "cd $REMOTE_DIR && sudo docker compose -f docker-compose.prod.yml exec -T api node dist/db/migrate.js"
fi

echo "==> Health check"
$SSH "curl -sf http://127.0.0.1:5000/health && echo"

echo "==> Done. https://$EC2_HOST/api/docs"
