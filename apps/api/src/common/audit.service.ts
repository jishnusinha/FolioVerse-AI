import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { newId } from './ids';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(e: {
    workspaceId?: string | null;
    actorId?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
    ip?: string | null;
  }) {
    await this.prisma.auditEvent.create({
      data: {
        id: newId(),
        workspaceId: e.workspaceId ?? null,
        actorId: e.actorId ?? null,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId ?? null,
        metadata: (e.metadata ?? {}) as any,
        ip: e.ip ?? null,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
