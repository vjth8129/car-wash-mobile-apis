# AWS environments

Each environment (`uat`, `prod`, ...) is one CloudFormation stack, `vahanly-<env>`, built from
[vahanly-stack.yml](vahanly-stack.yml). The stack contains:

- its own VPC with two public subnets
- an EC2 instance (Ubuntu 22.04) that runs the API in Docker behind nginx, serves the super admin
  portal at `/admin/`, and gets a Let's Encrypt certificate
- an Elastic IP, so the hostname (`<ip>.nip.io` or your own domain) never changes
- a private Postgres RDS instance that takes a final snapshot when it's deleted or replaced
- Secrets Manager secrets for the DB password and the JWT signing keys
- an S3 bucket for deploy bundles

Port 22 is closed and there are no key pairs. Deploys go through SSM Run Command, and the
instance writes its own `.env` from Secrets Manager.

All commands below need the company AWS account: prefix them with `AWS_PROFILE=company`, or
`export AWS_PROFILE=company` once per terminal.

## Ship changes to an environment

```bash
scripts/deploy.sh uat
```

This deploys the API from this repo and the super admin portal from `../car-wash-admin` (set
`ADMIN_DIR` to use another path). On the server it rebuilds the image, runs migrations, restarts the
API and publishes the portal. It ships the working tree, uncommitted changes included.

Flags:
- `--no-admin` ships only the API.
- `--seed` loads demo data and users. UAT only.

## Create a new environment

1. Copy the settings: `cp deploy/aws/params/uat.env deploy/aws/params/<env>.env`, then edit them.
   Give the new environment a `VpcCidr` that no other environment uses.
2. Run `scripts/create-stack.sh <env>`. It takes 10–15 minutes and prints the URLs at the end.
3. Run `scripts/deploy.sh <env>`.
4. Set the mobile app's API URL to the printed `ApiUrl` and rebuild the APK.

To use your own domain, set `Domain=` and point its DNS A record at the `ElasticIp` output.
Then run `create-stack.sh` and `deploy.sh` again. The deploy keeps retrying the certificate until
DNS resolves.

A fresh production database has no users. Create the first super admin deliberately. Don't use
`--seed` in production: it creates demo users with known passwords.

## Change an environment's settings

Edit `deploy/aws/params/<env>.env` (instance size, DB class, domain, and so on), then run
`scripts/create-stack.sh <env>` again. It updates the stack in place. Changing
`DBSnapshotIdentifier` on an existing stack **replaces the database**.

## Delete an environment

```bash
scripts/delete-stack.sh <env>
```

It asks you to type the env name, and the database takes a final snapshot first. Prod has
deletion protection on: set `DBDeletionProtection=false` and run `create-stack.sh` before deleting.

## Look up an environment

```bash
aws cloudformation describe-stacks --stack-name vahanly-uat --query 'Stacks[0].Outputs' --output table
```

## AWS account notes

- The account is on the AWS **free plan**. It caps RDS backups at 1 day and limits how many
  databases can run at once, so a second environment such as prod needs a paid plan.
- The IAM user needs these AWS-managed policies: `AWSCloudFormationFullAccess`,
  `AmazonEC2FullAccess`, `AmazonRDSFullAccess`, `AmazonS3FullAccess`, `AmazonSSMFullAccess`,
  `SecretsManagerReadWrite` and `IAMFullAccess`.
