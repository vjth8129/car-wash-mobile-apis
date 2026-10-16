#!/usr/bin/env bash
# Runs ON the instance (as root, via SSM Run Command from scripts/deploy.sh) from
# inside an extracted deploy bundle:
#   ./api/        the API source (built into the Docker image here)
#   ./admin/      the super admin portal's built static files (optional)
#   ./remote-deploy.sh
#
# Everything is idempotent, so this is also how config drift gets fixed: it rewrites
# .env from Secrets Manager, makes sure nginx + TLS are set up, builds the image,
# migrates the database, swaps the container, and publishes the admin portal.
#
# Flags: --seed   also run the demo seed (UAT only - it creates demo users and data)

set -euo pipefail

RUN_SEED=false
for arg in "$@"; do
  [ "$arg" = "--seed" ] && RUN_SEED=true
done

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/vahanly/api
ADMIN_ROOT=/var/www/carwash-admin
export PATH="$PATH:/snap/bin"
# Fixed project name: the image is built in $APP_DIR-next and started from $APP_DIR, and
# compose would otherwise name (and rebuild) the image per directory.
export COMPOSE_PROJECT_NAME=vahanly

# shellcheck disable=SC1091
source /etc/vahanly/stack.env
export AWS_DEFAULT_REGION="$AWS_REGION"

log() { echo "==> $*"; }

# ---------------------------------------------------------------------------
# .env - rebuilt from Secrets Manager on every deploy, never shipped in the bundle
# ---------------------------------------------------------------------------
write_env() {
  local db_json jwt_seed db_user db_pass
  db_json="$(aws secretsmanager get-secret-value --secret-id "$DB_SECRET_ARN" --query SecretString --output text)"
  db_user="$(jq -r .username <<< "$db_json")"
  db_pass="$(jq -r .password <<< "$db_json")"
  jwt_seed="$(aws secretsmanager get-secret-value --secret-id "$JWT_SECRET_ARN" --query SecretString --output text | jq -r .seed)"
  # Three independent signing keys from one stored seed.
  derive() { printf '%s' "$jwt_seed" | openssl dgst -sha512 -hmac "$1" | awk '{print $NF}'; }

  umask 077
  cat > "$1/.env" << EOF
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://${db_user}:${db_pass}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=no-verify
JWT_ACCESS_SECRET=$(derive access)
JWT_REFRESH_SECRET=$(derive refresh)
JWT_RESET_SECRET=$(derive reset)
ACCESS_TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
RESET_TOKEN_EXPIRES_IN=30m
DEV_RESET_CODE=${DEV_RESET_CODE}
CORS_ORIGIN=*
LOG_LEVEL=info
MAIL_PROVIDER=console
MAIL_FROM=no-reply@${APP_HOSTNAME}
APP_PUBLIC_URL=https://${APP_HOSTNAME}
EOF
  umask 022
}

# ---------------------------------------------------------------------------
# nginx: API at /, super admin portal at /admin/, TLS via Let's Encrypt
# ---------------------------------------------------------------------------
ensure_nginx() {
  local site=/etc/nginx/sites-available/vahanly
  install -m 644 "$BUNDLE_DIR/api/deploy/aws/nginx-admin.conf" /etc/nginx/snippets/vahanly-admin.conf

  if [ ! -f "$site" ]; then
    log "Writing nginx site for $APP_HOSTNAME"
    cat > "$site" << EOF
server {
    listen 80;
    server_name ${APP_HOSTNAME};
    client_max_body_size 2m;

    include snippets/vahanly-admin.conf;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Request-Id \$request_id;
    }

    access_log /var/log/nginx/vahanly.access.log;
    error_log  /var/log/nginx/vahanly.error.log;
}
EOF
    ln -sf "$site" /etc/nginx/sites-enabled/vahanly
    rm -f /etc/nginx/sites-enabled/default
  fi
  nginx -t
  systemctl reload nginx

  # certbot rewrites the site in place (adds the 443 block + redirect) the first time;
  # after that its timer renews. A failure (DNS not pointed yet, rate limit) only
  # leaves the site on plain HTTP - the next deploy tries again.
  if [ ! -d "/etc/letsencrypt/live/$APP_HOSTNAME" ]; then
    log "Requesting a TLS certificate for $APP_HOSTNAME"
    certbot --nginx -d "$APP_HOSTNAME" --non-interactive --agree-tos -m "$CERT_EMAIL" --redirect \
      || log "WARNING: certbot failed - serving HTTP only for now; re-run the deploy once DNS resolves here"
  fi
}

# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
deploy_api() {
  local next="$APP_DIR-next"
  rm -rf "$next"
  cp -a "$BUNDLE_DIR/api" "$next"
  write_env "$next"

  cd "$next"
  log "Building the API image"
  docker compose -f docker-compose.prod.yml build

  # Migrations are additive, so the running (old) container keeps working against the
  # new schema until the swap below.
  log "Running migrations"
  docker compose -f docker-compose.prod.yml run --rm -T api node dist/db/migrate.js < /dev/null
  if [ "$RUN_SEED" = true ]; then
    log "Seeding demo data"
    docker compose -f docker-compose.prod.yml run --rm -T api node dist/db/seed.js < /dev/null
  fi

  rm -rf "$APP_DIR-prev"
  [ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR-prev"
  mv "$next" "$APP_DIR"
  cd "$APP_DIR"
  docker compose -f docker-compose.prod.yml up -d --force-recreate
  docker image prune -f > /dev/null

  log "Health check"
  curl -sf --retry 15 --retry-delay 2 --retry-all-errors http://127.0.0.1:5000/health
  echo
}

# ---------------------------------------------------------------------------
# Super admin portal (static files)
# ---------------------------------------------------------------------------
deploy_admin() {
  if [ ! -d "$BUNDLE_DIR/admin" ]; then
    log "No admin portal in this bundle - leaving the current one in place"
    return
  fi
  log "Publishing the admin portal"
  rm -rf "$ADMIN_ROOT/admin-next" "$ADMIN_ROOT/admin-prev"
  cp -a "$BUNDLE_DIR/admin" "$ADMIN_ROOT/admin-next"
  chmod -R a+rX "$ADMIN_ROOT/admin-next"
  [ -d "$ADMIN_ROOT/admin" ] && mv "$ADMIN_ROOT/admin" "$ADMIN_ROOT/admin-prev"
  mv "$ADMIN_ROOT/admin-next" "$ADMIN_ROOT/admin"
}

log "Waiting for first-boot setup to finish"
cloud-init status --wait > /dev/null || true

ensure_nginx
deploy_api
deploy_admin

if [ -d "/etc/letsencrypt/live/$APP_HOSTNAME" ]; then
  log "Done: https://$APP_HOSTNAME/api/v1  |  https://$APP_HOSTNAME/admin/"
else
  log "Done (HTTP only): http://$APP_HOSTNAME/api/v1  |  http://$APP_HOSTNAME/admin/"
fi
