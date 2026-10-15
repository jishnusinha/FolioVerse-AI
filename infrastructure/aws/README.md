# FolioVerse on AWS (EC2 staging)

One Ubuntu 22.04 x86_64 EC2 instance runs the whole stack with Docker Compose v2. Images are built by
CodeBuild, stored in ECR, and deployed by CodeDeploy, all orchestrated by CodePipeline. Documents go to a private S3 bucket
through the instance role. Postgres, Redis and Qdrant run on the same host, and their data lives on a separate
encrypted EBS volume. Caddy terminates HTTPS on an Elastic IP. There is no Terraform, Kubernetes, ECS, load
balancer or NAT gateway.

> **Status:** these files are written and statically checked, but they are **not deployed**. Nothing here has
> created AWS resources yet. Treat the stack as unproven until a real deployment and an end-to-end document
> ingestion test both pass ([Section 8](#8-first-deployment-manual)).

```
Internet ──443/80──► edge (Caddy, Let's Encrypt, HSTS) ──► web (Caddy: SPA, /docs, /api proxy, headers)
                                                               │
                         ┌─────────────────────────────────────┴───────────┐
                         ▼                                                 ▼
                 api-http (NestJS) ◄── Redis/BullMQ ──► api-worker     ai-api (ROLE=api) / ai-ingest (ROLE=ingest)
                         │                                                 │
                         └──── Postgres ─── Qdrant (internal network, EBS volume) ───┘
                         S3 (documents, instance role)   Secrets Manager (one JSON secret)
```

| File | Purpose |
| --- | --- |
| `compose.yml`, `Caddyfile` | Production Compose project and the TLS edge configuration |
| `config/deploy.env.example` | Non-secret host settings; copied to `/etc/folioverse/deploy.env` |
| `config/secret-keys.example.json` | Key names in the Secrets Manager secret (no values) |
| `buildspec.yml` | CodeBuild: tests, three `linux/amd64` images, image checks, ECR push, deployment bundle |
| `appspec.yml`, `hooks/` | CodeDeploy lifecycle hooks; each one calls `scripts/deploy.sh` |
| `scripts/` | Host bootstrap, data volume, secrets, deploy, validate, rollback, backup, restore drill, diagnostics |
| `iam/`, `cicd/` | IAM trust and permission templates, and the CodeBuild, CodeDeploy and CodePipeline definitions |

## Names and placeholders

Use these names throughout. Replace each `<PLACEHOLDER>` with your own value; the scripts refuse to run while a
placeholder is still present.

| Thing | Name / value |
| --- | --- |
| Region | `<REGION>`; the examples use `ap-south-1` |
| Account | `<ACCOUNT_ID>` (12 digits) |
| Domain | `<DOMAIN>`, e.g. `staging.example.com` (an A record pointing to the Elastic IP) |
| Documents bucket | `<DOCUMENTS_BUCKET>` = `folioverse-staging-docs-<ACCOUNT_ID>` |
| Pipeline artifacts bucket | `<ARTIFACT_BUCKET>` = `folioverse-staging-artifacts-<ACCOUNT_ID>` |
| Backup bucket | `<BACKUP_BUCKET>` = `folioverse-staging-backups-<ACCOUNT_ID>` |
| Secret | `folioverse/staging/app`, whose ARN is `<SECRET_ARN>` |
| ECR repositories | `folioverse/api` (API, worker, migrations, seed), `folioverse/ai` (both AI roles), `folioverse/web` |
| EC2 instance | `folioverse-staging`, tagged `FolioVerseDeploy=staging` |
| Instance role and profile | `folioverse-staging-ec2` |
| Security group | `folioverse-staging-web` (inbound 80 and 443 only) |
| Data volume | `folioverse-staging-data` (gp3, encrypted), mounted at `/srv/folioverse-data` |
| CodeBuild project and role | `folioverse-staging-build`, `folioverse-staging-codebuild` |
| CodeDeploy application, group and role | `folioverse-staging`, `folioverse-staging-ec2`, `folioverse-staging-codedeploy` |
| CodePipeline and role | `folioverse-staging`, `folioverse-staging-codepipeline` |
| GitHub connection | `folioverse-github`, whose ARN is `<CONNECTION_ARN>` |
| SNS topic | `folioverse-staging-deployments` |

Bucket names must not contain dots, because the S3 client uses virtual-hosted HTTPS addressing.

Commands are labelled by where they run:

- **AWS CloudShell** (bash, already signed in) is used for every account-level step.
- **EC2 Linux** runs in a Session Manager shell on the instance (EC2 console → instance → **Connect** → **Session
  Manager**). Port 22 is never opened.
- **Windows CMD** is used only for preparing an upload, or for the optional local build.

---

## 1. Upload the deployment files to CloudShell

**Windows CMD** (from the repository root):

```bat
tar -a -c -f "%USERPROFILE%\Desktop\fv-aws.zip" -C infrastructure\aws .
```

In the AWS Console, select region `<REGION>`, open **CloudShell**, choose **Actions → Upload file**, and pick `fv-aws.zip`.

**AWS CloudShell**:

```bash
mkdir -p ~/fv && cd ~/fv && unzip -oq ~/fv-aws.zip && find . -type f \( -name '*.sh' -o -name '*.py' \) -exec sed -i 's/\r$//' {} +
export REGION=ap-south-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export DOCUMENTS_BUCKET=folioverse-staging-docs-$ACCOUNT_ID
export ARTIFACT_BUCKET=folioverse-staging-artifacts-$ACCOUNT_ID
export BACKUP_BUCKET=folioverse-staging-backups-$ACCOUNT_ID
export AWS_DEFAULT_REGION=$REGION
```

CloudShell keeps `~/fv` between sessions, but the `export` variables are lost. Run the `export` lines again
whenever you open a new session.

## 2. S3 buckets (private, encrypted)

**AWS CloudShell**:

```bash
for b in "$DOCUMENTS_BUCKET" "$ARTIFACT_BUCKET" "$BACKUP_BUCKET"; do
  aws s3api create-bucket --bucket "$b" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION"
  aws s3api put-public-access-block --bucket "$b" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-ownership-controls --bucket "$b" --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
  aws s3api put-bucket-encryption --bucket "$b" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
done
# CodePipeline requires versioning on its artifact store; the documents bucket keeps versions as a safety net.
aws s3api put-bucket-versioning --bucket "$ARTIFACT_BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-versioning --bucket "$DOCUMENTS_BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --bucket "$ARTIFACT_BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"expire","Status":"Enabled","Filter":{},"Expiration":{"Days":60},"NoncurrentVersionExpiration":{"NoncurrentDays":7}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$BACKUP_BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"expire","Status":"Enabled","Filter":{"Prefix":"folioverse/"},"Expiration":{"Days":35}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$DOCUMENTS_BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"old-versions","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":30},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":2}}]}'
```

No CORS rule is needed, because uploads go through the API (`FV_UPLOAD_MODE=proxy`) and browsers never talk to S3.
The application never creates buckets. If the documents bucket is missing or unreadable, the API exits at startup
and logs which of these it is: missing bucket, access denied, wrong region, or no credentials.

## 3. ECR repositories (immutable tags)

**AWS CloudShell**:

```bash
for r in api ai web; do
  aws ecr create-repository --repository-name "folioverse/$r" --image-tag-mutability IMMUTABLE \
    --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256
  aws ecr put-lifecycle-policy --repository-name "folioverse/$r" --lifecycle-policy-text \
    '{"rules":[{"rulePriority":1,"description":"keep 30 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":30},"action":{"type":"expire"}}]}'
done
```

Each build pushes a new tag, `<commit12>-b<build number>`, and every deployment pins images by digest.
Thirty images per repository covers the five releases kept on the host with plenty of room to spare.

## 4. Application secret (one-time initialization)

**AWS CloudShell**:

```bash
cd ~/fv && bash scripts/init-secrets.sh --secret-id folioverse/staging/app --region "$REGION"
export SECRET_ARN=$(aws secretsmanager describe-secret --secret-id folioverse/staging/app --query ARN --output text)
echo "$SECRET_ARN"
```

This step creates the secret with generated values: the Postgres and Redis passwords, the session JWT secret, and the ES256
key pair used for internal service tokens. Values are never displayed. Running it again only adds keys
that are missing; existing values are never regenerated. Deployments only **read** the secret. Changing
`POSTGRES_PASSWORD` after the first deployment does not change the password already stored in the database,
so don't rotate it here without also running `ALTER ROLE` first.

Optional keys (`config/secret-keys.example.json`) can be added later in the console: **Secrets Manager →
folioverse/staging/app → Retrieve secret value → Edit**. See [Section 12](#12-ai-mock-model-vs-a-real-provider) and
[Section 13](#13-email-smtp-is-off-by-default).

## 5. IAM roles

**AWS CloudShell**:

```bash
cd ~/fv && bash scripts/render-templates.sh rendered iam/ec2-instance-trust.json iam/ec2-instance-role-policy.json \
  iam/codebuild-trust.json iam/codebuild-policy.json iam/codedeploy-trust.json iam/codedeploy-policy.json \
  iam/codepipeline-trust.json

aws iam create-role --role-name folioverse-staging-ec2 --assume-role-policy-document file://rendered/ec2-instance-trust.json
aws iam put-role-policy --role-name folioverse-staging-ec2 --policy-name folioverse-staging-ec2 --policy-document file://rendered/ec2-instance-role-policy.json
aws iam attach-role-policy --role-name folioverse-staging-ec2 --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name folioverse-staging-ec2
aws iam add-role-to-instance-profile --instance-profile-name folioverse-staging-ec2 --role-name folioverse-staging-ec2

aws iam create-role --role-name folioverse-staging-codebuild --assume-role-policy-document file://rendered/codebuild-trust.json
aws iam put-role-policy --role-name folioverse-staging-codebuild --policy-name folioverse-staging-codebuild --policy-document file://rendered/codebuild-policy.json

aws iam create-role --role-name folioverse-staging-codedeploy --assume-role-policy-document file://rendered/codedeploy-trust.json
aws iam put-role-policy --role-name folioverse-staging-codedeploy --policy-name folioverse-staging-codedeploy --policy-document file://rendered/codedeploy-policy.json

aws iam create-role --role-name folioverse-staging-codepipeline --assume-role-policy-document file://rendered/codepipeline-trust.json
```

The CodePipeline permission policy is attached in [Section 9](#9-cicd-codepipeline--codebuild--codedeploy), once the
GitHub connection exists.

These policies are least-privilege. Each role can only touch its own buckets, repositories, secret, project and
deployment group. A few wildcards are unavoidable:

- `ecr:GetAuthorizationToken` has no resource-level permissions and must use `"Resource": "*"`. Image pulls and pushes are
  restricted to the three repositories.
- The CodeDeploy service role needs `ec2:DescribeInstances`, `ec2:DescribeInstanceStatus`, `tag:GetResources`
  and `cloudwatch:DescribeAlarms` on `*`, because these actions don't support resource-level permissions. All of them are read-only.
- `AmazonSSMManagedInstanceCore` is the AWS-managed policy for Session Manager and the SSM Agent.
- Every service trust policy is limited with `aws:SourceAccount`.

KMS is only needed in two cases. If you created the secret with a customer-managed key (`init-secrets.sh --kms-key-id`) or switched a bucket
to SSE-KMS with your own key, also render `iam/ec2-instance-kms-optional.json` and attach it, after setting
`SECRET_KMS_KEY_ARN` and `BUCKET_KMS_KEY_ARN`. The default `aws/secretsmanager` key and the `aws/s3` key that CodePipeline uses for artifacts
need no extra statements.

If a deployment fails with `AccessDenied` on a CodeDeploy-internal call, attach the AWS-managed
`AWSCodeDeployRole` policy to `folioverse-staging-codedeploy` and report the missing action so the template can
be tightened.

## 6. Network, instance, data volume, Elastic IP

### Security group

**AWS CloudShell**:

```bash
export VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
export SG_ID=$(aws ec2 create-security-group --group-name folioverse-staging-web --description "FolioVerse staging: HTTP/HTTPS only" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --ip-permissions \
  'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
  'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]'
```

Port 80 must stay open so Let's Encrypt can issue certificates (HTTP-01) and so HTTP can be redirected to HTTPS. Don't add port 22;
use Session Manager instead.

### Instance (IMDSv2 required, hop limit 2)

**AWS CloudShell**:

```bash
export AMI_ID=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id --query Parameter.Value --output text)
export INSTANCE_ID=$(aws ec2 run-instances --image-id "$AMI_ID" --instance-type t3.large \
  --iam-instance-profile Name=folioverse-staging-ec2 --security-group-ids "$SG_ID" \
  --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=40,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=folioverse-staging},{Key=FolioVerseDeploy,Value=staging}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" && echo "$INSTANCE_ID"
```

In the Console, the equivalent is **EC2 → Launch instance**:

- **Name:** `folioverse-staging`
- **AMI:** *Ubuntu Server 22.04 LTS (HVM), SSD, 64-bit (x86)*
- **Instance type:** `t3.large` (8 GiB is the minimum for Postgres, Qdrant, two AI processes with embedding models, and Node)
- **Key pair:** *Proceed without a key pair*
- **Security group:** `folioverse-staging-web`
- **Root volume:** 40 GiB, gp3, encrypted
- **Advanced details:**
  - **IAM instance profile:** `folioverse-staging-ec2`
  - **Metadata version:** *V2 only (token required)*
  - **Metadata response hop limit:** `2`
- **Tags:** add `FolioVerseDeploy=staging`

<a id="instance-metadata"></a>**Instance metadata.** IMDSv2 must be required, which disables IMDSv1. The hop limit must be **2**: containers sit
one network hop behind the host, and the S3 client inside the API container gets the instance-role
credentials from IMDS. With a hop limit of 1, uploads fail with "no credentials". `deploy.sh pull` checks this from inside a
container. To fix an existing instance:

```bash
aws ec2 modify-instance-metadata-options --instance-id "$INSTANCE_ID" --http-tokens required --http-put-response-hop-limit 2 --http-endpoint enabled
```

With a hop limit of 2, **every** container on the host can obtain the role's credentials, including the AI containers that process untrusted
documents. The role only has the permissions in `iam/ec2-instance-role-policy.json`. You can block other containers with a
`DOCKER-USER` iptables rule, but that isn't configured here.

### Data volume (separate, encrypted)

**AWS CloudShell**:

```bash
export AZ=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].Placement.AvailabilityZone' --output text)
export VOLUME_ID=$(aws ec2 create-volume --availability-zone "$AZ" --size 50 --volume-type gp3 --encrypted \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=folioverse-staging-data}]' --query VolumeId --output text)
aws ec2 wait volume-available --volume-ids "$VOLUME_ID"
aws ec2 attach-volume --volume-id "$VOLUME_ID" --instance-id "$INSTANCE_ID" --device /dev/sdf
echo "$VOLUME_ID"
```

This volume is never deleted together with the instance. Don't enable *Delete on termination* for it.

### Elastic IP and DNS

**AWS CloudShell**:

```bash
export EIP_ALLOC=$(aws ec2 allocate-address --domain vpc --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=folioverse-staging}]' --query AllocationId --output text)
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$EIP_ALLOC"
aws ec2 describe-addresses --allocation-ids "$EIP_ALLOC" --query 'Addresses[0].PublicIp' --output text
```

At your DNS provider, or in Route 53, create an **A record** that points `<DOMAIN>` to that IP. Wait until it resolves
(`nslookup <DOMAIN>` in **Windows CMD**) before the first deployment, because Caddy requests the certificate as soon as the edge starts.

### Notifications

**AWS CloudShell**:

```bash
aws sns create-topic --name folioverse-staging-deployments
aws sns subscribe --topic-arn "arn:aws:sns:$REGION:$ACCOUNT_ID:folioverse-staging-deployments" --protocol email --notification-endpoint <YOUR_EMAIL>
```

Confirm the subscription from the email you receive.

## 7. Prepare the host

Open **EC2 → folioverse-staging → Connect → Session Manager → Connect**. If Session Manager isn't offered,
wait two minutes: the agent registers shortly after boot. If it still isn't offered, check that the instance profile is attached.

To get the deployment files onto the instance, first upload them to the artifact bucket from **AWS CloudShell**:

```bash
aws s3 cp ~/fv-aws.zip "s3://$ARTIFACT_BUCKET/manual/fv-aws.zip"
```

Then, in **EC2 Linux**:

```bash
sudo snap install aws-cli --classic
aws s3 cp s3://<ARTIFACT_BUCKET>/manual/fv-aws.zip /tmp/fv-aws.zip
rm -rf /tmp/fv-bundle && python3 -m zipfile -e /tmp/fv-aws.zip /tmp/fv-bundle && sed -i 's/\r$//' /tmp/fv-bundle/scripts/*.sh /tmp/fv-bundle/scripts/*.py
sudo bash /tmp/fv-bundle/scripts/bootstrap-ec2.sh
```

`bootstrap-ec2.sh` is idempotent. It installs and verifies Docker Engine, Compose v2, AWS CLI v2, the SSM Agent and the CodeDeploy agent,
then creates `/etc/folioverse/deploy.env` from the example. Its final report checks that IMDSv1 is disabled and the instance role
works. The "EBS data volume" line stays FAIL until the next step.

Next, prepare the data volume (**EC2 Linux**):

```bash
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,SERIAL
sudo bash /tmp/fv-bundle/scripts/prepare-data-volume.sh --volume-id <VOLUME_ID> --format-blank-volume
```

The script only formats when the device carries **no** signature at all and you passed `--format-blank-volume`.
A volume that already has a filesystem is mounted as is. If it holds data from elsewhere without the FolioVerse
marker, the script refuses, unless you pass `--adopt-existing-data`. It also adds the volume to `/etc/fstab` by UUID with
`nofail`, and installs a systemd drop-in so Docker starts only after the volume is mounted. If the volume is missing at boot,
no container can write data to the root disk.

Then edit the host settings (**EC2 Linux**):

```bash
sudo nano /etc/folioverse/deploy.env
```

Set:

- `FV_ECR_REGISTRY=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com`
- `FV_DOCUMENTS_BUCKET`
- `FV_BACKUP_BUCKET`
- `FV_DOMAIN`
- `FV_ACME_EMAIL`
- `FV_SEED_ADMIN_EMAIL` (your email)

Keep `FV_SECRET_ID=folioverse/staging/app`. This file contains no secrets. Run `sudo bash /tmp/fv-bundle/scripts/bootstrap-ec2.sh`
again: every line should now say `ok`, and the nightly backup timer is enabled.

## 8. First deployment (manual)

A release consists of three images pinned by digest, plus a bundle: `appspec.yml`, `compose.yml`, `Caddyfile`, scripts,
hooks, the smoke test and `release.env`. There are two ways to produce the first release.

**Path A (recommended).** Create the pipeline from [Section 9](#9-cicd-codepipeline--codebuild--codedeploy) with the transition into the Deploy stage
**disabled**. Let the Source and Build stages run once, then download the build artifact.

In **AWS CloudShell**, find the artifact:

```bash
aws codepipeline list-action-executions --pipeline-name folioverse-staging \
  --query 'actionExecutionDetails[?stageName==`Build` && status==`Succeeded`]|[0].output.outputArtifacts[0].s3location' --output table
```

Then, in **EC2 Linux**, download the bucket and key it printed:

```bash
aws s3 cp s3://<ARTIFACT_BUCKET>/<KEY> /tmp/release.zip
rm -rf /tmp/fv-release && python3 -m zipfile -e /tmp/release.zip /tmp/fv-release
REL=$(sudo bash /tmp/fv-release/scripts/stage-release.sh --bundle /tmp/fv-release | tail -n 1)
echo "$REL"
```

**Path B (local build from Windows; needs Docker Desktop, AWS CLI v2 and about 10 GB of free disk).**

**Windows CMD**, from the repository root:

```bat
set REGION=ap-south-1
set REGISTRY=<ACCOUNT_ID>.dkr.ecr.%REGION%.amazonaws.com
for /f %i in ('git rev-parse --short^=12 HEAD') do set TAG=%i-manual1
aws ecr get-login-password --region %REGION% | docker login --username AWS --password-stdin %REGISTRY%
docker build --platform linux/amd64 -f infrastructure/docker/api.Dockerfile -t %REGISTRY%/folioverse/api:%TAG% .
docker build --platform linux/amd64 -f infrastructure/docker/ai.Dockerfile -t %REGISTRY%/folioverse/ai:%TAG% .
docker build --platform linux/amd64 -f infrastructure/docker/web.Dockerfile -t %REGISTRY%/folioverse/web:%TAG% .
docker push %REGISTRY%/folioverse/api:%TAG%
docker push %REGISTRY%/folioverse/ai:%TAG%
docker push %REGISTRY%/folioverse/web:%TAG%
docker run --rm -v "%CD%:/src:ro" -v "%TEMP%\fv-out:/out" bash:5.2 bash /src/infrastructure/aws/scripts/package-bundle.sh --out /out/bundle
tar -a -c -f "%TEMP%\fv-bundle.zip" -C "%TEMP%\fv-out\bundle" .
aws s3 cp "%TEMP%\fv-bundle.zip" s3://<ARTIFACT_BUCKET>/manual/fv-bundle-%TAG%.zip
echo %TAG%
```

ECR tags are immutable, so build again with a new suffix, such as `-manual2`, instead of overwriting a tag.

Then, in **EC2 Linux**, use the tag that was printed:

```bash
aws s3 cp s3://<ARTIFACT_BUCKET>/manual/fv-bundle-<TAG>.zip /tmp/release.zip
rm -rf /tmp/fv-release && python3 -m zipfile -e /tmp/release.zip /tmp/fv-release && sed -i 's/\r$//' /tmp/fv-release/scripts/*.sh
REL=$(sudo bash /tmp/fv-release/scripts/stage-release.sh --bundle /tmp/fv-release --tag <TAG> | tail -n 1)
echo "$REL"
```

With `--tag`, the script resolves the tag to digests in ECR, so the release is still pinned by digest.

### Deploy the staged release

**EC2 Linux**. You can run all the steps at once:

```bash
sudo "$REL/scripts/deploy.sh" --release "$REL" all
```

Or run them one at a time, which makes it easier to see which step fails:

```bash
sudo "$REL/scripts/deploy.sh" --release "$REL" preflight   # deploy.env, EBS mount + marker, Docker, digests
sudo "$REL/scripts/deploy.sh" --release "$REL" secrets     # Secrets Manager -> /etc/folioverse/secrets/*.env (0600)
sudo "$REL/scripts/deploy.sh" --release "$REL" pull        # compose config, ECR login, pull, container IMDS check
sudo "$REL/scripts/deploy.sh" --release "$REL" data        # Postgres, Redis, Qdrant healthy
sudo "$REL/scripts/deploy.sh" --release "$REL" migrate     # prisma migrate deploy (one-off container)
sudo "$REL/scripts/deploy.sh" --release "$REL" seed        # model registry seed (idempotent)
sudo "$REL/scripts/deploy.sh" --release "$REL" app         # AI roles, API, worker, web, edge; waits for health
sudo "$REL/scripts/deploy.sh" --release "$REL" promote     # /opt/folioverse/current -> this release
sudo "$REL/scripts/deploy.sh" --release "$REL" validate    # health, roles, ports, HTTPS, smoke
```

Guarantees:

- `app` refuses to start unless this release's migration step succeeded.
- A failed migration stops the run, and nothing new is started.
- Every step holds `/run/lock/folioverse-deploy.lock`, so deployments, rollbacks and backups never run concurrently.
- No step removes volumes or data.

Then check S3 storage end to end with the instance role (**EC2 Linux**):

```bash
sudo /opt/folioverse/current/scripts/storage-selftest.sh
```

This checks streamed upload, head, download, Range reads, multipart assembly, a signed internal GET (downloaded by the AI
ingest image) and deletion. It only writes under `_selftest/` and cleans up after itself.

**End-to-end acceptance (manual).** Finish with these steps:

1. Open `https://<DOMAIN>`.
2. Register the account `FV_SEED_ADMIN_EMAIL` **immediately**, because the first person to register that email becomes SUPER_ADMIN.
3. Create a source, upload a small PDF or EPUB, and wait for the ingestion to show *ready*.
4. Ask a question and confirm the answer cites the document.

The deployment counts as working only after this passes.

## 9. CI/CD: CodePipeline + CodeBuild + CodeDeploy

### GitHub connection

Open **Developer Tools → Settings → Connections → Create connection → GitHub**, name it `folioverse-github`, and choose
**Install a new app**. Select the `FolioVerse-AI` repository and click **Connect**. The connection's status must be
**Available**. Copy its ARN.

**AWS CloudShell**:

```bash
export CONNECTION_ARN=<CONNECTION_ARN>
export GITHUB_REPOSITORY=jishnusinha/FolioVerse-AI
export BRANCH=main
cd ~/fv && bash scripts/render-templates.sh rendered iam/codepipeline-policy.json cicd/codebuild-project.json cicd/codedeploy-deployment-group.json cicd/pipeline.json
aws iam put-role-policy --role-name folioverse-staging-codepipeline --policy-name folioverse-staging-codepipeline --policy-document file://rendered/codepipeline-policy.json

aws codebuild create-project --cli-input-json file://rendered/codebuild-project.json
aws codedeploy create-application --application-name folioverse-staging --compute-platform Server
aws codedeploy create-deployment-group --cli-input-json file://rendered/codedeploy-deployment-group.json
aws codepipeline create-pipeline --cli-input-json file://rendered/pipeline.json
# For the manual first deployment (Section 8, Path A): stop the first run before Deploy.
aws codepipeline disable-stage-transition --pipeline-name folioverse-staging --stage-name Deploy --transition-type Inbound --reason "manual first deployment"
```

Run the last command right away: creating the pipeline starts a run, and Source plus Build take several minutes.
After the manual first deployment passes, enable automatic deployments:

```bash
aws codepipeline enable-stage-transition --pipeline-name folioverse-staging --stage-name Deploy --transition-type Inbound
```

What the pipeline does:

- **Source.** A push to `<BRANCH>` triggers the pipeline. The source action exposes the commit as `#{SourceVariables.CommitId}`.
- **Execution mode QUEUED.** Pushes that arrive during a run wait their turn. Executions are never superseded halfway through a
  deployment, and CodeDeploy runs one deployment at a time per group, so migrations never run concurrently.
- **Build** (`buildspec.yml`, privileged mode for Docker):
  - Runs the API typecheck and unit tests, the infrastructure tests, the AI service tests and the AWS configuration checks.
  - Builds `api`, `ai` and `web` for `linux/amd64`, with the AI embedding models baked into the image.
  - Runs `scripts/check-images.sh`: non-root user, architecture, entry points, the isolated AI import of
    `folioverse_ai.serve` and `folioverse_ml` with no network, offline model loading, and Caddy validation.
  - Pushes `<commit12>-b<build>` tags and writes `release.env` with the digests.
  - Packages the bundle with `appspec.yml` at its root. There's no Git checkout on the EC2 host.
  - Provider keys are empty and `FV_LIVE_PROVIDER_TESTS=0`, so no paid AI call is made.
- **Deploy** (CodeDeploy, in place, `CodeDeployDefault.OneAtATime`, targeting instances tagged `FolioVerseDeploy=staging`):

| Hook | Runs |
| --- | --- |
| BeforeInstall | `deploy.env` present, data volume mounted, Docker running |
| AfterInstall | stage the bundle to `/opt/folioverse/releases/<RELEASE_ID>`, then `deploy.sh preflight secrets pull` |
| ApplicationStart | `deploy.sh data migrate seed app promote` |
| ValidateService | `validate.sh`: health of all services, both AI roles, worker, published ports, HTTPS, smoke |

If you prefer the Console, **CodePipeline → Create pipeline** works too:

- **Settings:** pipeline type **V2**, execution mode **Queued**, existing role
  `folioverse-staging-codepipeline`, custom artifact location `<ARTIFACT_BUCKET>`.
- **Source:** GitHub (via GitHub App), connection `folioverse-github`, branch `main`, output artifact format *CodePipeline default*,
  and set the variable namespace to `SourceVariables`.
- **Build:** project `folioverse-staging-build`, with the environment variable `FV_GIT_COMMIT` = `#{SourceVariables.CommitId}`.
- **Deploy:** CodeDeploy, application `folioverse-staging`, group `folioverse-staging-ec2`.
- When the CodeBuild wizard offers to modify the service role, decline.

**Failure reporting:**

- CodeDeploy publishes failure, rollback and success events to the SNS topic.
- For pipeline failures, add **CodePipeline → folioverse-staging → Notify → Create notification rule**, with the event *Pipeline execution: Failed* and the
  SNS target `folioverse-staging-deployments`. Let the console update the topic policy.
- Build logs are in CloudWatch under `/aws/codebuild/folioverse-staging-build`.
- Hook output appears in **CodeDeploy → Deployments → the deployment → View events**, and the full log is on the instance (see [Section 10](#10-logs-and-diagnostics)).

## 10. Logs and diagnostics

**EC2 Linux**:

```bash
sudo /opt/folioverse/current/scripts/diagnose.sh                    # releases, disk, mount, units, containers, error counts
sudo /opt/folioverse/current/scripts/diagnose.sh api-http --lines 300
sudo /opt/folioverse/current/scripts/validate.sh                    # read-only health + HTTPS + smoke
sudo docker compose -p folioverse ps
sudo docker logs --since 30m folioverse-api-worker-1
sudo tail -n 50 /var/log/folioverse/releases.log                    # deploy / rollback history
sudo tail -n 200 /opt/codedeploy-agent/deployment-root/deployment-logs/codedeploy-agent-deployments.log
sudo tail -n 100 /var/log/aws/codedeploy-agent/codedeploy-agent.log
```

The diagnostics never print environment variables, and secret files are root-only (`/etc/folioverse/secrets`, mode 0600).
Container logs use the `json-file` driver, capped at 10 MB × 5 files per container.

**Restarting one service** (**EC2 Linux**). This keeps the release and data:

```bash
cd /opt/folioverse/current && sudo docker compose -p folioverse --env-file /etc/folioverse/deploy.env --env-file release.env restart api-worker
```

## 11. Rollback

**EC2 Linux**:

```bash
sudo /opt/folioverse/current/scripts/rollback.sh                                   # back to `previous`
sudo /opt/folioverse/current/scripts/rollback.sh --to /opt/folioverse/releases/<RELEASE_ID>
```

Rollback starts the older release's images and validates them. **It does not run or reverse migrations.** The database
keeps the newer schema, so every migration must stay compatible with the previous release (expand first, contract in a
later release; see `infrastructure/runbooks/deploy.md`). If a migration damaged data, restore a backup instead
([Section 14](#14-backups-and-restore)).

When a deployment fails, CodeDeploy's automatic rollback redeploys the last successful bundle through the same hooks.
Its `prisma migrate deploy` step only applies pending migrations and never reverts newer ones. The host keeps the five newest
releases, plus `current` and `previous`, under `/opt/folioverse/releases`. Data lives outside them, on `/srv/folioverse-data`.

## 12. AI: mock model vs a real provider

Without provider keys, the AI service uses the deterministic **DEMO mock model**, which is labelled DEMO in the UI. That's the state after
the first deployment. Ingestion, embeddings (fastembed, baked into the image) and retrieval are real; only text
generation is mocked. This deployment configures no paid provider.

To use OpenAI, add these keys to the secret (**Secrets Manager → Edit**):

- `OPENAI_API_KEY`
- `FV_OPENAI_MODEL`: the exact model id your account may use
- optionally, `FV_OPENAI_FALLBACK_MODEL`

The registry seed (`config/models/registry.seed.yaml`) takes model ids only from these variables. The repository contains no
hard-coded model ids or prices. After adding the keys, apply them (**EC2 Linux**):

```bash
sudo /opt/folioverse/current/scripts/deploy.sh secrets seed app validate
```

Then, as SUPER_ADMIN, enter the model's prices with their source URL on the admin pricing page. Until a price exists, costs
can't be computed. Paid provider tests stay disabled: `FV_LIVE_PROVIDER_TESTS` is `0` in CI and CodeBuild, and nothing
here sets it.

## 13. Email (SMTP) is off by default

`FV_MAIL_ENABLED=false`, and the API logs `Mail disabled ... not sent` instead of sending. No email is delivered, which means:

| Flow | Effect with mail off |
| --- | --- |
| Email verification | No link is sent. Verification is not enforced, so accounts work, but the onboarding banner still says a link was sent. |
| Password reset | Unavailable. The request returns success, but no email arrives. Reset passwords directly in the database if needed. |
| Workspace invitations | Unusable. The invitation token is delivered only by email. |

To enable email, add `SMTP_URL` (`smtps://user:password@host:465`) to the secret, set `FV_MAIL_ENABLED=true` in
`/etc/folioverse/deploy.env`, and run `sudo /opt/folioverse/current/scripts/deploy.sh secrets app validate`. If you use
Amazon SES, a verified sender identity is needed, and the account must be out of the SES sandbox.

Registration is open by default (`FV_ALLOW_REGISTRATION=true`). Since verification isn't enforced, register the
`FV_SEED_ADMIN_EMAIL` account first. You can set `FV_ALLOW_REGISTRATION=false` afterwards and run `deploy.sh app`.

## 14. Backups and restore

`folioverse-backup.timer` runs `scripts/backup.sh` nightly at 20:30 UTC. It produces:

- a Postgres `pg_dump` in custom format, checked with `pg_restore --list`
- one snapshot per Qdrant collection
- a Redis RDB snapshot
- checksums

The backup goes to `s3://<BACKUP_BUCKET>/folioverse/<UTC timestamp>/`, encrypted with SSE-S3. The bucket keeps 35 days.
To run a backup manually (**EC2 Linux**):

```bash
sudo /opt/folioverse/current/scripts/backup.sh
```

**Restore drill (non-destructive; run it monthly)** (**EC2 Linux**):

```bash
sudo /opt/folioverse/current/scripts/restore-check.sh            # newest backup; or --stamp <UTC timestamp>
```

The drill downloads the backup and verifies the checksums. It restores Postgres into a throwaway container and prints row counts
(users, workspaces, sources, versions, runs, cost entries), then restores each Qdrant snapshot into a throwaway Qdrant and
prints point counts. The running stack isn't touched.

**Full restore (destructive, manual).** Run these steps on **EC2 Linux**, as root (`sudo -i`), and only after the drill
passed for the same stamp. They replace the current database and vector collections:

```bash
STAMP=<UTC timestamp>; REL=$(readlink -f /opt/folioverse/current); D=/srv/folioverse-data
cd "$REL" && C="docker compose -p folioverse --env-file /etc/folioverse/deploy.env --env-file release.env"
exec 9>/run/lock/folioverse-deploy.lock && flock 9          # no deployment or backup while restoring
aws s3 cp --recursive "s3://<BACKUP_BUCKET>/folioverse/$STAMP/" "$D/backups/restore-$STAMP/"
(cd "$D/backups/restore-$STAMP" && sha256sum -c SHA256SUMS)
$C stop edge web api-http api-worker ai-api ai-ingest
$C exec -T postgres pg_restore -U folioverse -d folioverse --clean --if-exists --no-owner --exit-on-error < "$D/backups/restore-$STAMP/postgres.dump"
mkdir -p "$D/qdrant-snapshots/restore"
for f in "$D/backups/restore-$STAMP"/qdrant/*.snapshot; do
  c=$(basename "$f" .snapshot); install -m 0644 "$f" "$D/qdrant-snapshots/restore/$c.snapshot"
  $C run --rm --no-deps -T ai-api python -c "import json,urllib.request as u; print(u.urlopen(u.Request('http://qdrant:6333/collections/$c/snapshots/recover?wait=true', data=json.dumps({'location':'file:///qdrant/snapshots/restore/$c.snapshot','priority':'snapshot'}).encode(), method='PUT', headers={'Content-Type':'application/json'}), timeout=1800).status)"
done
rm -rf "$D/qdrant-snapshots/restore"
$C up -d --wait --wait-timeout 900
flock -u 9; "$REL/scripts/validate.sh"
```

Redis only holds queues and rate-limit counters. Unfinished ingestion jobs from before the backup can be retried from
the UI, so restoring `redis.rdb` is normally unnecessary.

An EBS snapshot (**EC2 → Volumes → folioverse-staging-data → Create snapshot**, or Data Lifecycle Manager) is a
useful crash-consistent copy of the whole volume. It is **not** a verified restore: Postgres and Qdrant may be mid-write,
and nothing proves the snapshot can be restored until you try. The logical backups and the drill above are the tested path.

## 15. Security notes and limitations

- **Secrets.** One Secrets Manager JSON secret is rendered on every deployment into root-only files under
  `/etc/folioverse/secrets`. These files sit outside release directories, images and bundles, and Compose reads them with `env_file`, so
  `docker compose config` never shows them. They are never printed or regenerated. Postgres and Redis are on an internal Docker network
  with no published ports.
- **Edge.** Only `edge` publishes ports 80 and 443. The proxy chain is client → edge Caddy → web Caddy → API. The API trusts two proxy hops
  (`FV_TRUST_PROXY_HOPS=2`), and the web Caddy trusts forwarded headers only from the edge subnet. Together these keep client IPs, rate
  limits and `X-Forwarded-Proto` correct. Cookies are `Secure`, HSTS is on, and SSE is streamed without buffering.
- **Instance metadata.** IMDS is reachable from every container (hop limit 2; see [Instance metadata](#instance-metadata)).
- **Single host.** There is no high availability. An instance failure means downtime until it is replaced, and the data volume
  can be re-attached to the replacement. Restarting containers during a deployment causes a short interruption.
- **Not implemented here:**
  - WAF
  - CloudWatch agent or OpenTelemetry export (`OTEL_EXPORTER_OTLP_ENDPOINT` is empty)
  - email delivery
  - automatic EBS snapshots
- **Live provider tests stay disabled.**
