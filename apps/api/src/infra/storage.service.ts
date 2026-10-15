import { Global, Injectable, Module } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { env, storageConfig, type StorageConfig } from '../config/env';

/** Startup storage problem with an operator-facing reason. Never contains credentials. */
export class StorageConfigError extends Error {
  constructor(
    readonly reason: 'missing-bucket' | 'access-denied' | 'wrong-region' | 'no-credentials' | 'unreachable',
    message: string,
  ) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

/** Maps a HeadBucket failure to an actionable message. Only the bucket name and region are included. */
export function classifyBucketError(err: unknown, bucket: string, cfg: Pick<StorageConfig, 'provider' | 'region'>): StorageConfigError {
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const status = e?.$metadata?.httpStatusCode;
  const name = e?.name ?? 'Error';
  if (name === 'CredentialsProviderError' || /could not load credentials/i.test(e?.message ?? '')) {
    const hint =
      cfg.provider === 'aws'
        ? 'attach the EC2 instance profile and set the instance metadata (IMDSv2) response hop limit to 2 so containers can reach it'
        : 'set STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY';
    return new StorageConfigError('no-credentials', `Storage: no credentials were found; ${hint}`);
  }
  if (status === 404 || name === 'NotFound' || name === 'NoSuchBucket') {
    return new StorageConfigError('missing-bucket', `Storage: bucket "${bucket}" does not exist. Create it first (deployed environments never create buckets).`);
  }
  if (status === 301 || name === 'PermanentRedirect' || name === 'AuthorizationHeaderMalformed') {
    return new StorageConfigError('wrong-region', `Storage: bucket "${bucket}" is not in STORAGE_REGION=${cfg.region}. Set STORAGE_REGION to the bucket's region.`);
  }
  if (status === 403 || name === 'Forbidden' || name === 'AccessDenied') {
    return new StorageConfigError(
      'access-denied',
      `Storage: access denied to bucket "${bucket}". The runtime identity needs s3:ListBucket on the bucket and s3:GetObject, s3:PutObject and s3:DeleteObject on its objects; also check the bucket policy and any KMS key policy.`,
    );
  }
  return new StorageConfigError('unreachable', `Storage: bucket check failed (${name}${status ? `, HTTP ${status}` : ''}).`);
}

/**
 * StoragePort over the S3 API: Amazon S3 (STORAGE_PROVIDER=aws, instance-role credentials), SeaweedFS/MinIO
 * locally, or Google Cloud Storage through its S3-compatible XML API with HMAC keys.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly publicClient: S3Client;
  private readonly cfg: StorageConfig;
  readonly bucket: string;

  constructor() {
    const e = env();
    this.cfg = storageConfig(e);
    const base: S3ClientConfig = {
      region: this.cfg.region,
      forcePathStyle: this.cfg.forcePathStyle,
      ...(this.cfg.credentials ? { credentials: this.cfg.credentials } : {}),
      // GCS's XML API and most S3-compatible servers reject or mis-store aws-chunked checksum trailers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    const endpoint = (url?: string) => (url ? { endpoint: url } : {});
    this.client = new S3Client({ ...base, ...endpoint(this.cfg.endpoint) });
    this.publicClient = new S3Client({ ...base, ...endpoint(this.cfg.publicEndpoint ?? this.cfg.endpoint) });
    this.bucket = e.STORAGE_BUCKET;
  }

  /**
   * Verifies the bucket. Only a local S3-compatible emulator outside production gets a missing bucket created;
   * every other failure is reported with its cause.
   */
  async ensureBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (err) {
      const problem = classifyBucketError(err, this.bucket, this.cfg);
      const mayCreate = problem.reason === 'missing-bucket' && this.cfg.provider === 's3-compatible' && env().NODE_ENV !== 'production';
      if (!mayCreate) throw problem;
    }
    await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  signedPutUrl(key: string, contentType: string, expiresIn = 900) {
    return getSignedUrl(this.publicClient, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), {
      expiresIn,
    });
  }

  /** Signed GET for internal consumers (the AI service fetches through the internal endpoint). */
  signedGetUrl(key: string, expiresIn = 900, internal = true) {
    return getSignedUrl(internal ? this.client : this.publicClient, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn,
    });
  }

  async put(key: string, body: Buffer | Readable, contentType: string, contentLength?: number) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: contentLength }),
    );
  }

  async head(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType };
    } catch {
      return null;
    }
  }

  async getStream(key: string, range?: string): Promise<{ body: Readable; size?: number; contentType?: string; range?: string }> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }));
    return {
      body: r.Body as Readable,
      size: r.ContentLength,
      contentType: r.ContentType,
      range: r.ContentRange,
    };
  }

  async getBuffer(key: string, maxBytes?: number): Promise<Buffer> {
    const { body } = await this.getStream(key, maxBytes ? `bytes=0-${maxBytes - 1}` : undefined);
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async putPart(key: string, partNumber: number, body: Buffer, contentType: string) {
    const partKey = `${key}.parts/${partNumber}`;
    await this.put(partKey, body, contentType, body.length);
  }

  async assembleParts(key: string, totalParts: number, contentType: string): Promise<number> {
    const buffers: Buffer[] = [];
    const partKeys: string[] = [];
    for (let i = 1; i <= totalParts; i++) {
      const partKey = `${key}.parts/${i}`;
      partKeys.push(partKey);
      buffers.push(await this.getBuffer(partKey));
    }
    const full = Buffer.concat(buffers);
    await this.put(key, full, contentType, full.length);
    for (const pk of partKeys) {
      await this.delete(pk).catch(() => {});
    }
    return full.length;
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
