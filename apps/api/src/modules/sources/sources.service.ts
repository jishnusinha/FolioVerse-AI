import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { IngestionState } from '@prisma/client';
import type { Request } from 'express';
import { env } from '../../config/env';
import { AuditService } from '../../common/audit.service';
import { isUuid, newId, sha256Hex } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { QUEUES, QueuesService } from '../../infra/queues.service';
import { StorageService } from '../../infra/storage.service';
import { EventsService } from '../events/events.service';
import { ALLOWED, kindFromFilename, sanitizeFilename, scanBytes } from './file-scan';

export interface CreateUploadInput {
  projectId: string;
  folderId?: string;
  filename: string;
  sizeBytes: number;
  sourceId?: string;
}

@Injectable()
export class SourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queues: QueuesService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  async getSource(workspaceId: string, sourceId: string, includeDeleted = false) {
    if (!isUuid(sourceId)) throw new NotFoundException();
    const s = await this.prisma.source.findFirst({ where: { id: sourceId, workspaceId, ...(includeDeleted ? {} : { deletedAt: null }) } });
    if (!s) throw new NotFoundException();
    return s;
  }

  async getVersion(workspaceId: string, sourceId: string, versionId: string) {
    await this.getSource(workspaceId, sourceId);
    if (!isUuid(versionId)) throw new NotFoundException();
    const v = await this.prisma.sourceVersion.findFirst({ where: { id: versionId, sourceId, workspaceId } });
    if (!v) throw new NotFoundException();
    return v;
  }

  async createUpload(workspaceId: string, userId: string, input: CreateUploadInput) {
    const kind = kindFromFilename(input.filename);
    if (!kind) throw new BadRequestException({ message: 'Unsupported file type. Allowed: PDF, DOCX, EPUB, TXT, MD', code: 'UNSUPPORTED_TYPE' });
    const max = env().FV_MAX_UPLOAD_MB * 1024 * 1024;
    if (input.sizeBytes <= 0) throw new BadRequestException('File is empty');
    if (input.sizeBytes > max) throw new PayloadTooLargeException({ message: `File exceeds ${env().FV_MAX_UPLOAD_MB} MB`, code: 'TOO_LARGE' });
    const project = await this.prisma.project.findFirst({ where: { id: input.projectId, workspaceId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found');
    if (input.folderId) {
      const f = await this.prisma.folder.findFirst({ where: { id: input.folderId, workspaceId, projectId: project.id, deletedAt: null } });
      if (!f) throw new NotFoundException('Folder not found');
    }
    if (input.sourceId) await this.getSource(workspaceId, input.sourceId);

    const id = newId();
    const filename = sanitizeFilename(input.filename);
    const objectKey = `ws/${workspaceId}/uploads/${id}/${filename}`;
    const mimeType = ALLOWED[kind];
    await this.prisma.uploadSession.create({
      data: {
        id,
        workspaceId,
        projectId: project.id,
        folderId: input.folderId ?? null,
        userId,
        sourceId: input.sourceId ?? null,
        filename,
        mimeType,
        sizeBytes: input.sizeBytes,
        objectKey,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const url =
      env().FV_UPLOAD_MODE === 'signed'
        ? await this.storage.signedPutUrl(objectKey, mimeType)
        : `/api/workspaces/${workspaceId}/uploads/${id}/content`;
    return { uploadId: id, method: 'PUT', url, headers: { 'Content-Type': mimeType }, mode: env().FV_UPLOAD_MODE };
  }

  async receiveContent(workspaceId: string, uploadId: string, req: Request) {
    const s = await this.session(workspaceId, uploadId);
    const len = Number(req.headers['content-length'] ?? 0);
    if (!len || len > s.sizeBytes || len > env().FV_MAX_UPLOAD_MB * 1024 * 1024) {
      throw new BadRequestException({ message: 'Content-Length must match the declared size', code: 'SIZE_MISMATCH' });
    }
    await this.storage.put(s.objectKey, req, s.mimeType, len);
    return { received: len };
  }

  private async session(workspaceId: string, uploadId: string) {
    if (!isUuid(uploadId)) throw new NotFoundException();
    const s = await this.prisma.uploadSession.findFirst({ where: { id: uploadId, workspaceId } });
    if (!s) throw new NotFoundException();
    if (s.completedAt) throw new BadRequestException({ message: 'Upload already completed', code: 'ALREADY_COMPLETED' });
    if (s.expiresAt < new Date()) throw new BadRequestException({ message: 'Upload session expired', code: 'EXPIRED' });
    return s;
  }

  /** Verifies stored bytes, creates Source + immutable SourceVersion, then queues ingestion. */
  async completeUpload(workspaceId: string, userId: string, uploadId: string, title?: string) {
    const s = await this.session(workspaceId, uploadId);
    const head = await this.storage.head(s.objectKey);
    if (!head) throw new BadRequestException({ message: 'No content was uploaded', code: 'NO_CONTENT' });
    if (head.size !== s.sizeBytes) throw new BadRequestException({ message: 'Uploaded size does not match', code: 'SIZE_MISMATCH' });

    const buf = await this.storage.getBuffer(s.objectKey);
    const sha256 = sha256Hex(buf);
    const kind = kindFromFilename(s.filename)!;

    const sourceId = s.sourceId ?? newId();
    const versionId = newId();
    const storedObjectId = newId();
    const prevVersions = s.sourceId ? await this.prisma.sourceVersion.count({ where: { sourceId } }) : 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.storedObject.create({
        data: { id: storedObjectId, workspaceId, bucket: this.storage.bucket, key: s.objectKey, sizeBytes: head.size, sha256, mimeType: s.mimeType },
      });
      if (!s.sourceId) {
        await tx.source.create({
          data: {
            id: sourceId,
            workspaceId,
            projectId: s.projectId,
            folderId: s.folderId,
            title: (title || s.filename).slice(0, 200),
            kind: kind === 'epub' ? 'BOOK' : 'DOCUMENT',
            mimeType: s.mimeType,
            ingestionState: 'SCANNING',
            createdById: userId,
          },
        });
      }
      await tx.sourceVersion.create({
        data: {
          id: versionId,
          workspaceId,
          sourceId,
          versionNo: prevVersions + 1,
          storedObjectId,
          mimeType: s.mimeType,
          sha256,
          sizeBytes: head.size,
          ingestionState: 'SCANNING',
          createdById: userId,
        },
      });
      await tx.source.update({ where: { id: sourceId }, data: { currentVersionId: versionId, ingestionState: 'SCANNING' } });
      await tx.uploadSession.update({ where: { id: s.id }, data: { completedAt: new Date(), state: 'SCANNING', sourceId } });
      if (s.sourceId) {
        await tx.$executeRaw`
          UPDATE app.artifacts SET stale = true, updated_at = now()
           WHERE workspace_id = ${workspaceId}::uuid AND NOT stale
             AND source_version_ids && ARRAY(SELECT id FROM app.source_versions WHERE source_id = ${sourceId}::uuid AND id <> ${versionId}::uuid)`;
      }
    });
    await this.stage(workspaceId, sourceId, versionId, 'SCANNING', 0.1);

    const scan = scanBytes(buf, kind);
    if (!scan.ok) {
      await this.setState(workspaceId, sourceId, versionId, 'QUARANTINED', scan.reason);
      await this.audit.record({ workspaceId, actorId: userId, action: 'source.quarantine', resourceType: 'source_version', resourceId: versionId, metadata: { reason: scan.reason } });
      return { sourceId, versionId, state: 'QUARANTINED', reason: scan.reason };
    }
    await this.setState(workspaceId, sourceId, versionId, 'PREVIEW_READY');
    await this.audit.record({ workspaceId, actorId: userId, action: 'source.upload', resourceType: 'source_version', resourceId: versionId, metadata: { kind, bytes: head.size } });
    await this.enqueueIngestion(workspaceId, versionId);
    return { sourceId, versionId, state: 'PREVIEW_READY' };
  }

  async enqueueIngestion(workspaceId: string, versionId: string) {
    const jobId = newId();
    await this.prisma.ingestionJob.create({ data: { id: jobId, workspaceId, sourceVersionId: versionId, state: 'PREVIEW_READY' } });
    await this.queues.queue(QUEUES.ingestion).add('ingest', { jobId, workspaceId, sourceVersionId: versionId }, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    return jobId;
  }

  async setState(workspaceId: string, sourceId: string, versionId: string, state: IngestionState, error?: string, progress?: number) {
    await this.prisma.sourceVersion.update({ where: { id: versionId }, data: { ingestionState: state, ingestionError: error ?? null } });
    const src = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (src?.currentVersionId === versionId) await this.prisma.source.update({ where: { id: sourceId }, data: { ingestionState: state } });
    await this.stage(workspaceId, sourceId, versionId, state, progress, error);
  }

  async stage(workspaceId: string, sourceId: string, versionId: string, state: IngestionState, progress?: number, message?: string) {
    await this.events.publishWorkspace(workspaceId, 'ingestion.stage', { sourceId, sourceVersionId: versionId, state, progress, message });
  }
}
