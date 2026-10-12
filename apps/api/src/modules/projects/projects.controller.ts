import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { ProjectKind } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';

const KINDS = ['KNOWLEDGE', 'WRITER', 'LIBRARY'] as const;

class CreateProjectDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty({ enum: KINDS }) @IsEnum(KINDS) kind: ProjectKind;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
}
class UpdateProjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() archived?: boolean;
}
class CreateFolderDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
}
class UpdateFolderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string | null;
}

@ApiTags('projects')
@Controller('workspaces/:workspaceId')
export class ProjectsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async project(workspaceId: string, projectId: string, includeDeleted = false) {
    if (!isUuid(projectId)) throw new NotFoundException();
    const p = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId, ...(includeDeleted ? {} : { deletedAt: null }) } });
    if (!p) throw new NotFoundException();
    return p;
  }

  @Get('projects')
  async list(@Param('workspaceId') workspaceId: string, @Query('kind') kind?: ProjectKind) {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    const counts = await this.prisma.source.groupBy({
      by: ['projectId'],
      where: { workspaceId, deletedAt: null },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.projectId, c._count._all]));
    return projects.map((p) => ({ ...p, sourceCount: byId.get(p.id) ?? 0 }));
  }

  @RequireRole('EDITOR')
  @Post('projects')
  async create(@Param('workspaceId') workspaceId: string, @Body() dto: CreateProjectDto, @CurrentUser() u: AuthUser) {
    const p = await this.prisma.project.create({
      data: { id: newId(), workspaceId, name: dto.name, kind: dto.kind, description: dto.description ?? '', createdById: u.id },
    });
    await this.audit.record({ workspaceId, actorId: u.id, action: 'project.create', resourceType: 'project', resourceId: p.id });
    return p;
  }

  @Get('projects/:projectId')
  async get(@Param('workspaceId') workspaceId: string, @Param('projectId') projectId: string) {
    return this.project(workspaceId, projectId);
  }

  @RequireRole('EDITOR')
  @Patch('projects/:projectId')
  async update(@Param('workspaceId') workspaceId: string, @Param('projectId') projectId: string, @Body() dto: UpdateProjectDto) {
    await this.project(workspaceId, projectId);
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: dto.name,
        description: dto.description,
        archivedAt: dto.archived === undefined ? undefined : dto.archived ? new Date() : null,
      },
    });
  }

  @RequireRole('ADMIN')
  @HttpCode(204)
  @Delete('projects/:projectId')
  async trash(@Param('workspaceId') workspaceId: string, @Param('projectId') projectId: string, @CurrentUser() u: AuthUser) {
    await this.project(workspaceId, projectId);
    await this.prisma.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
    await this.audit.record({ workspaceId, actorId: u.id, action: 'project.trash', resourceType: 'project', resourceId: projectId });
  }

  @RequireRole('ADMIN')
  @Post('projects/:projectId/restore')
  async restore(@Param('workspaceId') workspaceId: string, @Param('projectId') projectId: string) {
    await this.project(workspaceId, projectId, true);
    return this.prisma.project.update({ where: { id: projectId }, data: { deletedAt: null } });
  }

  @Get('trash')
  async trashList(@Param('workspaceId') workspaceId: string) {
    const [projects, sources] = await Promise.all([
      this.prisma.project.findMany({ where: { workspaceId, deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
      this.prisma.source.findMany({ where: { workspaceId, deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
    ]);
    const purgeAfterDays = 30;
    const purgeAt = (d: Date | null) => (d ? new Date(d.getTime() + purgeAfterDays * 86400_000) : null);
    return {
      purgeAfterDays,
      projects: projects.map((p) => ({ ...p, purgeAt: purgeAt(p.deletedAt) })),
      sources: sources.map((s) => ({ ...s, purgeAt: purgeAt(s.deletedAt) })),
    };
  }

  // ── folders ──

  @Get('projects/:projectId/folders')
  async folders(@Param('workspaceId') workspaceId: string, @Param('projectId') projectId: string) {
    await this.project(workspaceId, projectId);
    return this.prisma.folder.findMany({ where: { workspaceId, projectId, deletedAt: null }, orderBy: { path: 'asc' } });
  }

  @RequireRole('EDITOR')
  @Post('projects/:projectId/folders')
  async createFolder(@Param('workspaceId') workspaceId: string, @Param('projectId') projectId: string, @Body() dto: CreateFolderDto) {
    await this.project(workspaceId, projectId);
    const id = newId();
    let path = `/${id}`;
    if (dto.parentId) {
      const parent = await this.prisma.folder.findFirst({ where: { id: dto.parentId, workspaceId, projectId, deletedAt: null } });
      if (!parent) throw new NotFoundException('Parent folder not found');
      path = `${parent.path}/${id}`;
    }
    return this.prisma.folder.create({ data: { id, workspaceId, projectId, parentId: dto.parentId ?? null, name: dto.name, path } });
  }

  @RequireRole('EDITOR')
  @Patch('folders/:folderId')
  async updateFolder(@Param('workspaceId') workspaceId: string, @Param('folderId') folderId: string, @Body() dto: UpdateFolderDto) {
    if (!isUuid(folderId)) throw new NotFoundException();
    const f = await this.prisma.folder.findFirst({ where: { id: folderId, workspaceId, deletedAt: null } });
    if (!f) throw new NotFoundException();
    if (dto.parentId !== undefined && dto.parentId !== f.parentId) {
      let newPath = `/${f.id}`;
      if (dto.parentId) {
        const parent = await this.prisma.folder.findFirst({ where: { id: dto.parentId, workspaceId, projectId: f.projectId, deletedAt: null } });
        if (!parent) throw new NotFoundException('Parent folder not found');
        if (parent.path.startsWith(f.path)) throw new BadRequestException('Cannot move a folder into itself');
        newPath = `${parent.path}/${f.id}`;
      }
      const descendants = await this.prisma.folder.findMany({ where: { workspaceId, path: { startsWith: `${f.path}/` } } });
      await this.prisma.$transaction([
        this.prisma.folder.update({ where: { id: f.id }, data: { parentId: dto.parentId, path: newPath, name: dto.name ?? f.name } }),
        ...descendants.map((d) => this.prisma.folder.update({ where: { id: d.id }, data: { path: newPath + d.path.slice(f.path.length) } })),
      ]);
      return this.prisma.folder.findUnique({ where: { id: f.id } });
    }
    return this.prisma.folder.update({ where: { id: f.id }, data: { name: dto.name ?? f.name } });
  }

  @RequireRole('EDITOR')
  @HttpCode(204)
  @Delete('folders/:folderId')
  async deleteFolder(@Param('workspaceId') workspaceId: string, @Param('folderId') folderId: string) {
    if (!isUuid(folderId)) throw new NotFoundException();
    const f = await this.prisma.folder.findFirst({ where: { id: folderId, workspaceId, deletedAt: null } });
    if (!f) throw new NotFoundException();
    const now = new Date();
    const ids = (await this.prisma.folder.findMany({ where: { workspaceId, OR: [{ id: f.id }, { path: { startsWith: `${f.path}/` } }] } })).map((x) => x.id);
    await this.prisma.$transaction([
      this.prisma.folder.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
      this.prisma.source.updateMany({ where: { workspaceId, folderId: { in: ids }, deletedAt: null }, data: { deletedAt: now } }),
    ]);
  }
}
