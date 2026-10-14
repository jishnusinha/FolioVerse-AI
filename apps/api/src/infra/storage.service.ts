import { Global, Injectable, Module } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { env } from '../config/env';

/**
 * StoragePort over the S3 API. MinIO locally; Google Cloud Storage through its S3-compatible
 * XML API with HMAC keys (STORAGE_ENDPOINT=https://storage.googleapis.com).
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly publicClient: S3Client;
  readonly bucket: string;

  constructor() {
    const e = env();
    const base = {
      region: e.STORAGE_REGION,
      forcePathStyle: e.STORAGE_FORCE_PATH_STYLE,
      credentials: { accessKeyId: e.STORAGE_ACCESS_KEY, secretAccessKey: e.STORAGE_SECRET_KEY },
      // GCS's XML API and most S3-compatible servers reject or mis-store aws-chunked checksum trailers.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.client = new S3Client({ ...base, endpoint: e.STORAGE_ENDPOINT });
    this.publicClient = new S3Client({ ...base, endpoint: e.STORAGE_PUBLIC_ENDPOINT || e.STORAGE_ENDPOINT });
    this.bucket = e.STORAGE_BUCKET;
  }

  async ensureBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
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
