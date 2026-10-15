#!/usr/bin/env bash
# One script to provision (if missing) and deploy the Car Wash API to AWS.
#
# Run it with no arguments and it will:
#   1. Print the IAM permissions your access key needs (so you can create/fix the
#      IAM user before continuing).
#   2. Ask for that access key + secret (or read them from the environment).
#   3. Check what already exists in the account for this stack, by name/tag.
#   4. Create whatever's missing (security groups, RDS, EC2 + Elastic IP, Docker,
#      nginx, a free TLS certificate) - or, if it's all already there, skip
#      straight to shipping the current code to it.
#   5. Deploy: package this repo, copy it over, rebuild, migrate, restart.
#
# Safe to re-run, any time, for any reason - every creation step checks for an
# existing resource first, so re-running against an already-provisioned stack
# just redeploys your latest changes.
#
# Usage:
#   ./scripts/aws-deploy.sh --show-permissions        # print the IAM policy and exit
#   ./scripts/aws-deploy.sh                           # interactive - prompts for keys/region/stack/domain
#   ./scripts/aws-deploy.sh --seed                    # also (re-)run the seed script after deploying
#
# Non-interactive (e.g. CI), set these in the environment instead of being prompted:
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  - required
#   AWS_REGION        - default: ap-south-1
#   STACK_NAME        - default: carwash        (used to name/tag every resource -
#                        use a different value to run a second, independent stack
#                        in the same account)
#   DOMAIN            - optional company domain (e.g. api.example.com). If its DNS
#                        doesn't already point at this stack's Elastic IP, HTTPS
#                        setup is skipped with a message instead of failing - rerun
#                        once DNS is in place. If unset, a free nip.io hostname
#                        derived from the Elastic IP is used instead.
#   SSH_KEY           - path to an existing <stack>-deploy-key.pem, if you already
#                        have one (e.g. this is a redeploy from a different machine).
#                        If omitted and the key pair already exists in AWS, SSH
#                        falls back to EC2 Instance Connect automatically.

set -euo pipefail

STACK_NAME="${STACK_NAME:-carwash}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
RUN_SEED=false
for arg in "$@"; do
  case "$arg" in
    --show-permissions) show_permissions_and_exit=true ;;
    --seed) RUN_SEED=true ;;
  esac
done

# ---------------------------------------------------------------------------
# IAM permissions
# ---------------------------------------------------------------------------
print_iam_policy() {
  cat << 'EOF'
================================================================================
 IAM permissions needed
================================================================================
Create an IAM user with PROGRAMMATIC ACCESS ONLY (no console login, never use
the account's root user), then attach permissions one of two ways:

  OPTION A - quick (two AWS-managed policies):
    AmazonEC2FullAccess
    AmazonRDSFullAccess
    (+ AmazonRoute53FullAccess, only if your domain's DNS is hosted in this
    same AWS account's Route 53 - most companies host DNS elsewhere, e.g.
    Cloudflare/GoDaddy, in which case skip this one.)

  OPTION B - least-privilege (a custom policy with just what this script uses):
EOF

  cat << 'POLICY'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CarWashDeploy",
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity",
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups",
        "ec2:CreateSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:DeleteSecurityGroup",
        "ec2:DescribeKeyPairs",
        "ec2:CreateKeyPair",
        "ec2:DeleteKeyPair",
        "ec2:DescribeImages",
        "ec2:RunInstances",
        "ec2:DescribeInstances",
        "ec2:TerminateInstances",
        "ec2:CreateTags",
        "ec2:DescribeTags",
        "ec2:AllocateAddress",
        "ec2:AssociateAddress",
        "ec2:DisassociateAddress",
        "ec2:DescribeAddresses",
        "ec2:ReleaseAddress",
        "ec2-instance-connect:SendSSHPublicKey",
        "rds:DescribeDBInstances",
        "rds:CreateDBInstance",
        "rds:DeleteDBInstance",
        "rds:DescribeDBSubnetGroups",
        "rds:CreateDBSubnetGroup",
        "rds:DeleteDBSubnetGroup",
        "rds:DescribeDBEngineVersions",
        "rds:AddTagsToResource",
        "rds:ListTagsForResource"
      ],
      "Resource": "*"
    }
  ]
}
POLICY
  cat << 'EOF'
================================================================================
Once attached: IAM user -> Security credentials -> Create access key
(use case: Command Line Interface) -> copy the Access Key ID + Secret.
================================================================================
EOF
}

print_iam_policy
if [ "${show_permissions_and_exit:-false}" = true ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Credentials and config
# ---------------------------------------------------------------------------
if [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
  read -r -p "AWS Access Key ID: " AWS_ACCESS_KEY_ID
fi
if [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  read -r -s -p "AWS Secret Access Key: " AWS_SECRET_ACCESS_KEY
  echo
fi
if [ -t 0 ] && [ -z "${STACK_NAME_SET:-}" ]; then
  read -r -p "Stack name [${STACK_NAME}]: " input_stack
  STACK_NAME="${input_stack:-$STACK_NAME}"
fi
if [ -t 0 ] && [ -z "${AWS_REGION_SET:-}" ]; then
  read -r -p "AWS region [${AWS_REGION}]: " input_region
  AWS_REGION="${input_region:-$AWS_REGION}"
fi
if [ -t 0 ] && [ -z "${DOMAIN:-}" ]; then
  read -r -p "Domain for HTTPS (blank = free nip.io hostname, set up later): " DOMAIN
fi

export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION="$AWS_REGION"

echo "==> Verifying credentials"
IDENTITY="$(aws sts get-caller-identity --output json)"
echo "$IDENTITY"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$REPO_ROOT/.deploy/$STACK_NAME"
mkdir -p "$STATE_DIR"
SSH_KEY="${SSH_KEY:-$STATE_DIR/$STACK_NAME-deploy-key.pem}"

SG_API_NAME="$STACK_NAME-api-sg"
SG_DB_NAME="$STACK_NAME-db-sg"
KEY_NAME="$STACK_NAME-deploy-key"
DB_ID="$STACK_NAME-db"
DB_SUBNET_GROUP="$STACK_NAME-db-subnet-group"
EC2_NAME_TAG="$STACK_NAME-api"
EC2_USER="ubuntu"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() { echo "==> $*"; }

# ---------------------------------------------------------------------------
# Network (always already exists - the account's default VPC)
# ---------------------------------------------------------------------------
VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  echo "No default VPC found in $AWS_REGION - create one or set up a VPC manually first." >&2
  exit 1
fi
mapfile -t SUBNET_IDS < <(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" --query 'Subnets[].SubnetId' --output text | tr '\t' '\n')
log "Using default VPC $VPC_ID (${#SUBNET_IDS[@]} subnets)"

# ---------------------------------------------------------------------------
# Security groups (idempotent)
# ---------------------------------------------------------------------------
ensure_security_groups() {
  API_SG_ID="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_API_NAME" Name=vpc-id,Values="$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
  if [ "$API_SG_ID" = "None" ] || [ -z "$API_SG_ID" ]; then
    log "Creating security group $SG_API_NAME"
    API_SG_ID="$(aws ec2 create-security-group --group-name "$SG_API_NAME" --description "$STACK_NAME API - EC2" --vpc-id "$VPC_ID" --query 'GroupId' --output text)"
    aws ec2 authorize-security-group-ingress --group-id "$API_SG_ID" --protocol tcp --port 22 --cidr 0.0.0.0/0 >/dev/null
    aws ec2 authorize-security-group-ingress --group-id "$API_SG_ID" --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null
    aws ec2 authorize-security-group-ingress --group-id "$API_SG_ID" --protocol tcp --port 443 --cidr 0.0.0.0/0 >/dev/null
  else
    log "Security group $SG_API_NAME already exists ($API_SG_ID)"
  fi

  DB_SG_ID="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_DB_NAME" Name=vpc-id,Values="$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
  if [ "$DB_SG_ID" = "None" ] || [ -z "$DB_SG_ID" ]; then
    log "Creating security group $SG_DB_NAME"
    DB_SG_ID="$(aws ec2 create-security-group --group-name "$SG_DB_NAME" --description "$STACK_NAME API - RDS" --vpc-id "$VPC_ID" --query 'GroupId' --output text)"
    aws ec2 authorize-security-group-ingress --group-id "$DB_SG_ID" --protocol tcp --port 5432 --source-group "$API_SG_ID" >/dev/null
  else
    log "Security group $SG_DB_NAME already exists ($DB_SG_ID)"
  fi
}

# ---------------------------------------------------------------------------
# Key pair (idempotent - AWS never returns existing key material, so we can
# only save it locally the moment we create it)
# ---------------------------------------------------------------------------
ensure_key_pair() {
  if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
    log "Key pair $KEY_NAME already exists in AWS"
    if [ ! -f "$SSH_KEY" ]; then
      log "No local copy at $SSH_KEY - SSH will fall back to EC2 Instance Connect"
      SSH_KEY=""
    fi
  else
    log "Creating key pair $KEY_NAME"
    aws ec2 create-key-pair --key-name "$KEY_NAME" --query 'KeyMaterial' --output text > "$SSH_KEY"
    chmod 400 "$SSH_KEY"
    log "Saved private key to $SSH_KEY - back this up, it cannot be recovered from AWS"
  fi
}

# ---------------------------------------------------------------------------
# RDS (idempotent)
# ---------------------------------------------------------------------------
ensure_rds() {
  FRESH_DB=false
  DB_STATUS="$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || true)"
  if [ -z "$DB_STATUS" ] || [ "$DB_STATUS" = "None" ]; then
    FRESH_DB=true
    aws rds describe-db-subnet-groups --db-subnet-group-name "$DB_SUBNET_GROUP" >/dev/null 2>&1 || \
      aws rds create-db-subnet-group \
        --db-subnet-group-name "$DB_SUBNET_GROUP" \
        --db-subnet-group-description "$STACK_NAME RDS subnet group" \
        --subnet-ids "${SUBNET_IDS[@]}" >/dev/null

    DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
    echo "$DB_PASSWORD" > "$STATE_DIR/db-password.txt"
    chmod 600 "$STATE_DIR/db-password.txt"

    PG_VERSION="$(aws rds describe-db-engine-versions --engine postgres --query 'DBEngineVersions[-1].EngineVersion' --output text)"
    log "Creating RDS instance $DB_ID (postgres $PG_VERSION) - this takes 5-10 minutes"
    aws rds create-db-instance \
      --db-instance-identifier "$DB_ID" \
      --engine postgres --engine-version "$PG_VERSION" \
      --db-instance-class db.t4g.micro \
      --allocated-storage 20 --storage-type gp3 \
      --master-username carwash_admin --master-user-password "$DB_PASSWORD" \
      --db-name carwash \
      --vpc-security-group-ids "$DB_SG_ID" \
      --db-subnet-group-name "$DB_SUBNET_GROUP" \
      --no-publicly-accessible \
      --backup-retention-period 1 \
      --no-multi-az >/dev/null
    log "Waiting for $DB_ID to become available..."
    aws rds wait db-instance-available --db-instance-identifier "$DB_ID"
  else
    log "RDS instance $DB_ID already exists (status: $DB_STATUS)"
    if [ -f "$STATE_DIR/db-password.txt" ]; then
      DB_PASSWORD="$(cat "$STATE_DIR/db-password.txt")"
    else
      echo "RDS exists but $STATE_DIR/db-password.txt is missing - set DB_PASSWORD yourself, or reset the master password in the RDS console." >&2
      exit 1
    fi
  fi
  DB_ENDPOINT="$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" --query 'DBInstances[0].Endpoint.Address' --output text)"
}

# ---------------------------------------------------------------------------
# EC2 + Elastic IP (idempotent)
# ---------------------------------------------------------------------------
ensure_ec2() {
  FRESH_EC2=false
  INSTANCE_ID="$(aws ec2 describe-instances \
    --filters Name=tag:Name,Values="$EC2_NAME_TAG" Name=instance-state-name,Values=pending,running,stopping,stopped \
    --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)"

  if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
    FRESH_EC2=true
    AMI_ID="$(aws ec2 describe-images --owners 099720109477 \
      --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" "Name=state,Values=available" \
      --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)"

    cat > "$STATE_DIR/user-data.sh" << 'USERDATA'
#!/bin/bash
set -e
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu
systemctl enable docker
systemctl start docker
touch /home/ubuntu/.docker-ready
USERDATA

    log "Launching EC2 instance ($AMI_ID, t3.micro)"
    INSTANCE_ID="$(aws ec2 run-instances \
      --image-id "$AMI_ID" \
      --instance-type t3.micro \
      --key-name "$KEY_NAME" \
      --security-group-ids "$API_SG_ID" \
      --subnet-id "${SUBNET_IDS[0]}" \
      --associate-public-ip-address \
      --user-data "file://$STATE_DIR/user-data.sh" \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$EC2_NAME_TAG}]" \
      --query 'Instances[0].InstanceId' --output text)"
    log "Waiting for $INSTANCE_ID to be running..."
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  else
    log "EC2 instance $EC2_NAME_TAG already exists ($INSTANCE_ID)"
  fi

  EIP="$(aws ec2 describe-addresses --filters Name=instance-id,Values="$INSTANCE_ID" --query 'Addresses[0].PublicIp' --output text 2>/dev/null || true)"
  if [ -z "$EIP" ] || [ "$EIP" = "None" ]; then
    log "Allocating and attaching an Elastic IP"
    ALLOC_ID="$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text)"
    aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
    EIP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)"
  else
    log "Elastic IP already attached: $EIP"
  fi
  NIP_DOMAIN="$(echo "$EIP" | tr '.' '-').nip.io"
}

# ---------------------------------------------------------------------------
# Wait for SSH + Docker, preferring a saved key, else EC2 Instance Connect
# ---------------------------------------------------------------------------
connect_ssh() {
  if [ -n "$SSH_KEY" ] && [ -f "$SSH_KEY" ]; then
    SSH_IDENTITY="$SSH_KEY"
  else
    log "No local key - pushing a temporary one via EC2 Instance Connect"
    SSH_IDENTITY="$STATE_DIR/eic_key"
    ssh-keygen -q -t ed25519 -N '' -f "$SSH_IDENTITY" -C "aws-deploy-$(date +%s)"
    aws ec2-instance-connect send-ssh-public-key \
      --instance-id "$INSTANCE_ID" --instance-os-user "$EC2_USER" \
      --ssh-public-key "file://$SSH_IDENTITY.pub" >/dev/null
  fi
  SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=5 -o ControlMaster=auto -o ControlPath=$STATE_DIR/cm.sock -o ControlPersist=15m -i $SSH_IDENTITY"
  ssh $SSH_OPTS -fN "$EC2_USER@$EIP"
  SSH="ssh $SSH_OPTS $EC2_USER@$EIP"
  SCP="scp $SSH_OPTS"
}

wait_for_docker() {
  log "Waiting for the instance to finish installing Docker..."
  for i in $(seq 1 30); do
    $SSH "test -f /home/ubuntu/.docker-ready" 2>/dev/null && return 0
    sleep 10
  done
  echo "Docker did not finish installing in time - check /var/log/cloud-init-output.log on the instance." >&2
  exit 1
}

# ---------------------------------------------------------------------------
# nginx + TLS (idempotent - skips cleanly if already configured, or if a
# custom domain isn't pointed here yet)
# ---------------------------------------------------------------------------
ensure_nginx_and_tls() {
  local site_name="$STACK_NAME-api"
  local has_site
  has_site="$($SSH "[ -f /etc/nginx/sites-enabled/$site_name ] && echo yes || echo no" 2>/dev/null || echo no)"

  if [ "$has_site" = "no" ]; then
    log "Installing nginx + certbot"
    $SSH "sudo apt-get update -qq && sudo apt-get install -y -qq nginx certbot python3-certbot-nginx" >/dev/null

    log "Writing nginx reverse-proxy config for $NIP_DOMAIN"
    $SSH "sudo tee /etc/nginx/sites-available/$site_name >/dev/null" << EOF
server {
    listen 80;
    server_name $NIP_DOMAIN;
    client_max_body_size 2m;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    $SSH "sudo ln -sf /etc/nginx/sites-available/$site_name /etc/nginx/sites-enabled/$site_name && sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx"

    log "Requesting certificate for $NIP_DOMAIN (always resolves, so this always succeeds)"
    $SSH "sudo certbot --nginx -d $NIP_DOMAIN --non-interactive --agree-tos -m admin@$NIP_DOMAIN --redirect" >/dev/null
  else
    log "nginx site $site_name already configured"
  fi

  if [ -n "${DOMAIN:-}" ]; then
    local has_domain_site
    has_domain_site="$($SSH "sudo grep -rl 'server_name.*$DOMAIN' /etc/nginx/sites-enabled/ 2>/dev/null | head -1 || true")"
    if [ -z "$has_domain_site" ]; then
      local resolved
      resolved="$(dig +short "$DOMAIN" | tail -1)"
      if [ "$resolved" = "$EIP" ]; then
        log "$DOMAIN resolves here - adding it to nginx and requesting its certificate"
        $SSH "sudo sed -i 's/server_name $NIP_DOMAIN;/server_name $NIP_DOMAIN $DOMAIN;/' /etc/nginx/sites-available/$site_name && sudo nginx -t && sudo systemctl reload nginx"
        $SSH "sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN --redirect" >/dev/null
        PRIMARY_DOMAIN="$DOMAIN"
      else
        log "$DOMAIN doesn't resolve to $EIP yet (got: '${resolved:-nothing}') - skipping it for now."
        log "Point its DNS at $EIP and re-run this script to finish HTTPS for that domain."
        PRIMARY_DOMAIN="$NIP_DOMAIN"
      fi
    else
      log "$DOMAIN already configured with its own certificate"
      PRIMARY_DOMAIN="$DOMAIN"
    fi
  else
    PRIMARY_DOMAIN="$NIP_DOMAIN"
  fi
}

# ---------------------------------------------------------------------------
# Deploy the app
# ---------------------------------------------------------------------------
deploy_app() {
  log "Packaging $REPO_ROOT"
  local archive="$STATE_DIR/app.tar.gz"
  tar --exclude='node_modules' --exclude='dist' --exclude='.git' --exclude='coverage' \
    -czf "$archive" -C "$REPO_ROOT" .

  log "Uploading"
  $SCP "$archive" "$EC2_USER@$EIP:/home/$EC2_USER/app-deploy.tar.gz"

  local remote_dir="car-wash-apis"
  local env_block=""
  if [ "$FRESH_DB" = true ] || [ "$FRESH_EC2" = true ]; then
    # First deploy on this instance: write a fresh production .env. Re-runs after
    # this keep whatever .env is already on the box untouched.
    local jwt_access jwt_refresh jwt_reset
    jwt_access="$(openssl rand -hex 64)"; jwt_refresh="$(openssl rand -hex 64)"; jwt_reset="$(openssl rand -hex 64)"
    env_block="cat > .env << 'ENVEOF'
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://carwash_admin:${DB_PASSWORD}@${DB_ENDPOINT}:5432/carwash?sslmode=no-verify
JWT_ACCESS_SECRET=${jwt_access}
JWT_REFRESH_SECRET=${jwt_refresh}
JWT_RESET_SECRET=${jwt_reset}
ACCESS_TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
RESET_TOKEN_EXPIRES_IN=30m
CORS_ORIGIN=*
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
FORGOT_PASSWORD_RATE_LIMIT_MAX=5
MAIL_PROVIDER=console
MAIL_FROM=no-reply@${PRIMARY_DOMAIN}
APP_PUBLIC_URL=https://${PRIMARY_DOMAIN}
ENVEOF"
  fi

  log "Extracting, building, and restarting"
  $SSH bash -s << REMOTE
set -euo pipefail
rm -rf ${remote_dir}-new
mkdir ${remote_dir}-new
tar -xzf app-deploy.tar.gz -C ${remote_dir}-new
rm -f app-deploy.tar.gz
cd ${remote_dir}-new
${env_block}
[ -f .env ] && chmod 600 .env
cd ..
# Only carry the old .env forward if this deploy didn't just write a fresh one
# (e.g. the DB was recreated but the instance wasn't - env_block above already
# has the correct, current secrets and must not be clobbered by a stale copy).
if [ ! -f ${remote_dir}-new/.env ] && [ -f ${remote_dir}/.env ]; then
  cp ${remote_dir}/.env ${remote_dir}-new/.env
fi
rm -rf ${remote_dir}-old
[ -d ${remote_dir} ] && mv ${remote_dir} ${remote_dir}-old
mv ${remote_dir}-new ${remote_dir}
rm -rf ${remote_dir}-old
cd ${remote_dir}
sudo docker compose -f docker-compose.prod.yml build
sudo docker compose -f docker-compose.prod.yml run --rm -T api node dist/db/migrate.js </dev/null
if [ "${RUN_SEED}" = true ]; then
  sudo docker compose -f docker-compose.prod.yml run --rm -T api node dist/db/seed.js </dev/null
fi
sudo docker compose -f docker-compose.prod.yml up -d --force-recreate
REMOTE

  log "Health check"
  $SSH "curl -sf --retry 10 --retry-delay 2 --retry-all-errors http://127.0.0.1:5000/health && echo"
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
ensure_security_groups
ensure_key_pair
ensure_rds
ensure_ec2

trap '[ -n "${SSH_OPTS:-}" ] && ssh $SSH_OPTS -O exit "$EC2_USER@$EIP" 2>/dev/null; true' EXIT
connect_ssh
wait_for_docker
ensure_nginx_and_tls
if [ "$FRESH_EC2" = true ] || [ "$FRESH_DB" = true ]; then
  RUN_SEED=true
fi
deploy_app

echo
echo "================================================================================"
echo " Done"
echo "================================================================================"
echo "  Stack:    $STACK_NAME"
echo "  API:      https://$PRIMARY_DOMAIN/api/v1"
echo "  Docs:     https://$PRIMARY_DOMAIN/api/docs"
echo "  Instance: $INSTANCE_ID  ($EIP)"
echo "  Database: $DB_ID  ($DB_ENDPOINT)"
if [ -n "$SSH_KEY" ] && [ -f "$SSH_KEY" ]; then
  echo "  SSH key:  $SSH_KEY  (back this up - not recoverable from AWS)"
fi
if [ "$FRESH_DB" = true ]; then
  echo "  DB password saved to: $STATE_DIR/db-password.txt"
fi
echo "================================================================================"
