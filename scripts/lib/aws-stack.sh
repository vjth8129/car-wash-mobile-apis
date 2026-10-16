# Shared by scripts/create-stack.sh, deploy.sh and delete-stack.sh - not run directly.
# Expects the caller to have set ENV_NAME. Each environment is the CloudFormation stack
# "vahanly-<env>" built from deploy/aws/vahanly-stack.yml.
#
# AWS credentials come from the usual places (AWS_PROFILE, env vars). Region: AWS_REGION,
# default ap-south-1.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE="$REPO_ROOT/deploy/aws/vahanly-stack.yml"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"

log() { echo "==> $*"; }
die() { echo "error: $*" >&2; exit 1; }

require_env_name() {
  [[ "${ENV_NAME:-}" =~ ^[a-z][a-z0-9-]{1,15}$ ]] || die "usage: $0 <env>   (e.g. uat, prod)"
  STACK="vahanly-$ENV_NAME"
}

stack_exists() {
  aws cloudformation describe-stacks --stack-name "$STACK" > /dev/null 2>&1
}

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

print_outputs() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
}
