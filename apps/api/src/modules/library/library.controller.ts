import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { RunsService } from '../runs/runs.service';
import { LibraryService } from './library.service';
import { type Locator, pageForLocator } from './locator';
import { MetadataService } from './metadata.service';

const STATUSES = ['TO_READ', 'READING', 'FINISHED', 'ABANDONED'] as const;
const COLORS = ['amber', 'sage', 'rose', 'sky'] as const;
export const EXPLAIN_MODES = ['explain', 'define', 'summarize', 'context', 'ask'] as const;

class BookDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) subtitle?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(200, { each: true }) authors?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) language?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) publisher?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3000) publishedYear?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(/^97[89]\d{10}$/, { message: 'isbn13 must be 13 digits starting with 978 or 979' }) isbn13?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(100, { each: true }) subjects?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000) pageCount?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(/^https:\/\/[^\s"'<>]+$/, { message: 'coverUrl must be an https URL' }) @MaxLength(500) coverUrl?: string;
  @ApiPropertyOptional({ enum: ['MANUAL', 'OPEN_LIBRARY', 'GOOGLE_BOOKS'] }) @IsOptional() @IsIn(['MANUAL', 'OPEN_LIBRARY', 'GOOGLE_BOOKS']) metadataSource?: 'MANUAL' | 'OPEN_LIBRARY' | 'GOOGLE_BOOKS';
  @ApiPropertyOptional() @IsOptional() @IsObject() externalIds?: Record<string, string>;
}
class UpdateBookDto extends PartialType(BookDto) {}
class CreateItemDto {
  @ApiPropertyOptional({ description: 'An uploaded book file (EPUB or PDF)' }) @IsOptional() @IsUUID() sourceId?: string;
  @ApiPropertyOptional({ type: BookDto, description: 'Manual entry or a confirmed metadata result' }) @IsOptional() @ValidateNested() @Type(() => BookDto) book?: BookDto;
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
}
class UpdateItemDto {
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @ApiPropertyOptional({ minimum: 0, maximum: 5, description: '0 clears the rating' }) @IsOptional() @IsInt() @Min(0) @Max(5) rating?: number;
  @ApiPropertyOptional({ type: UpdateBookDto }) @IsOptional() @ValidateNested() @Type(() => UpdateBookDto) book?: UpdateBookDto;
}
class ProgressDto {
  @ApiProperty({ description: 'Reader Locator { href, type, title, locations { progression, totalProgression, position, cfi, page } }' }) @IsObject() locator: Record<string, unknown>;
  @ApiProperty({ minimum: 0, maximum: 1 }) @IsNumber() @Min(0) @Max(1) percent: number;
  @ApiPropertyOptional({ description: 'Reading time since the last report (capped at one hour)' }) @IsOptional() @IsInt() @Min(0) @Max(3600) secondsDelta?: number;
}
class CreateAnnotationDto {
  @ApiPropertyOptional({ description: 'Client-generated id; repeating a create with the same id is a no-op' }) @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ enum: ['HIGHLIGHT', 'NOTE'] }) @IsIn(['HIGHLIGHT', 'NOTE']) kind: 'HIGHLIGHT' | 'NOTE';
  @ApiPropertyOptional({ enum: COLORS }) @IsOptional() @IsIn(COLORS) color?: string;
  @ApiProperty() @IsObject() locator: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) quote?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) note?: string;
}
class UpdateAnnotationDto {
  @ApiPropertyOptional({ enum: COLORS }) @IsOptional() @IsIn(COLORS) color?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) note?: string;
}
class CreateBookmarkDto {
  @ApiProperty() @IsObject() locator: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) label?: string;
}
class CollectionDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}
class UpdateCollectionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}
class CollectionItemDto {
  @ApiProperty() @IsUUID() itemId: string;
}
class ExplainDto {
  @ApiProperty({ enum: EXPLAIN_MODES }) @IsIn(EXPLAIN_MODES) mode: (typeof EXPLAIN_MODES)[number];
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) passage: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) question?: string;
  @ApiProperty({ description: 'Where the passage is; it bounds what the model may see (spoiler guard)' }) @IsObject() locator: Record<string, unknown>;
}
class ReaderExcerptDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) quote: string;
  @ApiProperty() @IsObject() locator: Record<string, unknown>;
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1_000_000 ? v : undefined);
const prune = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(typeof v === 'object' && v && !Object.keys(v).length))) as T;

/** Keeps only the known Locator fields, bounded, so stored positions stay small and well-formed. */
export function cleanLocator(raw: Record<string, unknown>): Locator {
  const l = (raw.locations ?? {}) as Record<string, unknown>;
  const t = (raw.text ?? {}) as Record<string, unknown>;
  return prune({
    href: str(raw.href, 500),
    type: str(raw.type, 100),
    title: str(raw.title, 300),
    locations: prune({
      progression: num(l.progression, 0, 1),
      totalProgression: num(l.totalProgression, 0, 1),
      position: int(l.position),
      cfi: str(l.cfi, 500),
      page: int(l.page),
    }),
    text: prune({ before: str(t.before, 500), highlight: str(t.highlight, 4000), after: str(t.after, 500) }),
  }) as Locator;
}

const toneOf = (title: string) => ([...title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 6) + 1;

@ApiTags('library')
@Controller('workspaces/:workspaceId/library')
export class LibraryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly library: LibraryService,
    private readonly metadata: MetadataService,
    private readonly runs: RunsService,
  ) {}

  @Get('items')
  async list(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('collectionId') collectionId?: string, @Query('q') q?: string) {
    const items = await this.prisma.libraryItem.findMany({
      where: {
        workspaceId,
        userId: u.id,
        ...(status && (STATUSES as readonly string[]).includes(status) ? { status: status as any } : {}),
        ...(collectionId && isUuid(collectionId) ? { collections: { some: { collectionId } } } : {}),
        ...(q?.trim() ? { book: { OR: [{ title: { contains: q.trim(), mode: 'insensitive' } }, { authors: { has: q.trim() } }] } } : {}),
      },
      include: { book: true, progress: true, collections: { select: { collectionId: true } } },
      orderBy: [{ lastOpenedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 500,
    });
    const sources = await this.prisma.source.findMany({
      where: { id: { in: items.map((i) => i.sourceId!).filter(Boolean) }, workspaceId, deletedAt: null },
      select: { id: true, mimeType: true, ingestionState: true },
    });
    const byId = new Map(sources.map((s) => [s.id, s]));
    return items.map(({ collections, ...i }) => ({ ...i, collectionIds: collections.map((c) => c.collectionId), source: i.sourceId ? (byId.get(i.sourceId) ?? null) : null }));
  }

  /** Adds a book to the caller's shelf, from an uploaded file (`sourceId`) or from manual/confirmed metadata (`book`). */
  @Post('items')
  async create(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: CreateItemDto) {
    if (!dto.sourceId && !dto.book) throw new BadRequestException({ message: 'Provide a sourceId or book details', code: 'VALIDATION' });
    const source = dto.sourceId ? await this.library.source(workspaceId, dto.sourceId) : null;
    if (dto.sourceId && !source) throw new NotFoundException('Source not found');
    if (source) {
      const existing = await this.prisma.libraryItem.findFirst({ where: { workspaceId, userId: u.id, sourceId: source.id } });
      if (existing) return this.detail(workspaceId, u, existing.id);
    }
    const title = dto.book?.title ?? source!.title.replace(/\.(epub|pdf)$/i, '');
    const bookId = newId();
    const itemId = newId();
    const status = dto.status ?? 'TO_READ';
    await this.prisma.$transaction([
      this.prisma.book.create({
        data: {
          id: bookId,
          workspaceId,
          title,
          subtitle: dto.book?.subtitle ?? null,
          authors: dto.book?.authors ?? [],
          language: dto.book?.language ?? null,
          publisher: dto.book?.publisher ?? null,
          publishedYear: dto.book?.publishedYear ?? null,
          isbn13: dto.book?.isbn13 ?? null,
          description: dto.book?.description ?? null,
          subjects: dto.book?.subjects ?? [],
          pageCount: dto.book?.pageCount ?? null,
          coverUrl: dto.book?.coverUrl ?? null,
          coverTone: toneOf(title),
          metadataSource: dto.book?.metadataSource ?? 'MANUAL',
          externalIds: (dto.book?.externalIds ?? {}) as any,
          createdById: u.id,
        },
      }),
      this.prisma.libraryItem.create({
        data: {
          id: itemId,
          workspaceId,
          userId: u.id,
          bookId,
          sourceId: source?.id ?? null,
          status,
          startedAt: status === 'READING' || status === 'FINISHED' ? new Date() : null,
          finishedAt: status === 'FINISHED' ? new Date() : null,
        },
      }),
    ]);
    if (source && !dto.book) await this.library.applyIngestedMetadata(source.id, await this.library.ingestedMetadata(source.currentVersionId));
    return this.detail(workspaceId, u, itemId);
  }

  @Get('items/:itemId')
  async detail(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    const source = await this.library.source(workspaceId, item.sourceId);
    const version = source?.currentVersionId
      ? await this.prisma.sourceVersion.findUnique({ where: { id: source.currentVersionId }, select: { id: true, mimeType: true, pageCount: true, ingestionState: true } })
      : null;
    const [chapters, collections] = await Promise.all([
      this.library.chapters(version?.id),
      this.prisma.collectionItem.findMany({ where: { itemId: item.id }, select: { collectionId: true } }),
    ]);
    return { ...item, source, version, chapters, collectionIds: collections.map((c) => c.collectionId) };
  }

  @Patch('items/:itemId')
  async update(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Body() dto: UpdateItemDto) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    const data: Record<string, unknown> = {};
    if (dto.rating !== undefined) data.rating = dto.rating || null;
    if (dto.status && dto.status !== item.status) {
      const now = new Date();
      data.status = dto.status;
      if (dto.status === 'TO_READ') Object.assign(data, { startedAt: null, finishedAt: null });
      if (dto.status === 'READING') Object.assign(data, { startedAt: item.startedAt ?? now, finishedAt: null });
      if (dto.status === 'FINISHED') Object.assign(data, { startedAt: item.startedAt ?? now, finishedAt: now });
      if (dto.status === 'ABANDONED') data.finishedAt = null;
    }
    if (dto.book) {
      const { metadataSource, externalIds, ...fields } = dto.book;
      await this.prisma.book.update({
        where: { id: item.bookId },
        data: { ...fields, ...(metadataSource ? { metadataSource } : {}), ...(externalIds ? { externalIds: externalIds as any } : {}) },
      });
    }
    if (Object.keys(data).length) await this.prisma.libraryItem.update({ where: { id: item.id }, data });
    return this.detail(workspaceId, u, item.id);
  }

  /** Removes the book from the shelf with its progress, annotations and bookmarks. An uploaded file stays in the workspace. */
  @HttpCode(204)
  @Delete('items/:itemId')
  async remove(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    await this.prisma.book.delete({ where: { id: item.bookId } });
  }

  @Put('items/:itemId/progress')
  async progress(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Body() dto: ProgressDto) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    const locator = cleanLocator(dto.locator);
    const source = await this.library.source(workspaceId, item.sourceId);
    const chapters = await this.library.chapters(source?.currentVersionId);
    const page = pageForLocator(chapters, locator);
    const chapterIndex = page && chapters.length ? chapters.findIndex((c) => c.page === page) : null;
    const progress = await this.prisma.readingProgress.upsert({
      where: { itemId: item.id },
      create: { id: newId(), workspaceId, userId: u.id, itemId: item.id, locator: locator as any, percent: dto.percent, chapterIndex },
      update: { locator: locator as any, percent: dto.percent, chapterIndex },
    });
    await this.prisma.libraryItem.update({
      where: { id: item.id },
      data: { lastOpenedAt: new Date(), ...(item.status === 'TO_READ' ? { status: 'READING', startedAt: item.startedAt ?? new Date() } : {}) },
    });
    await this.library.addReadingTime(workspaceId, u.id, item.id, dto.secondsDelta ?? 0);
    return progress;
  }

  /** Without `since`: live annotations. With `since` (ISO time): every change after it, including deletions (tombstones). */
  @Get('items/:itemId/annotations')
  async annotations(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Query('since') since?: string) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    const after = since ? new Date(since) : null;
    if (after && Number.isNaN(after.getTime())) throw new BadRequestException({ message: 'since must be an ISO date-time', code: 'VALIDATION' });
    const rows = await this.prisma.annotation.findMany({
      where: { itemId: item.id, userId: u.id, ...(after ? { updatedAt: { gt: after } } : { deletedAt: null }) },
      orderBy: { updatedAt: 'asc' },
      take: 2000,
    });
    return { annotations: rows, serverTime: new Date().toISOString() };
  }

  @Post('items/:itemId/annotations')
  async createAnnotation(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Body() dto: CreateAnnotationDto) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    if (dto.id) {
      const prior = await this.prisma.annotation.findUnique({ where: { id: dto.id } });
      if (prior && prior.userId === u.id && prior.itemId === item.id) return prior;
      if (prior) throw new ConflictException({ message: 'Annotation id already used', code: 'ID_CONFLICT' });
    }
    if (dto.kind === 'NOTE' && !dto.note?.trim()) throw new BadRequestException({ message: 'A note needs text', code: 'VALIDATION' });
    const source = await this.library.source(workspaceId, item.sourceId);
    return this.prisma.annotation.create({
      data: {
        id: dto.id ?? newId(),
        workspaceId,
        userId: u.id,
        itemId: item.id,
        sourceVersionId: source?.currentVersionId ?? null,
        kind: dto.kind,
        color: dto.color ?? 'amber',
        locator: cleanLocator(dto.locator) as any,
        quote: dto.quote ?? '',
        note: dto.note?.trim() || null,
      },
    });
  }

  @Patch('items/:itemId/annotations/:annotationId')
  async updateAnnotation(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Param('annotationId') id: string, @Body() dto: UpdateAnnotationDto) {
    const a = await this.annotation(workspaceId, u, itemId, id);
    return this.prisma.annotation.update({
      where: { id: a.id },
      data: { ...(dto.color ? { color: dto.color } : {}), ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}) },
    });
  }

  @HttpCode(204)
  @Delete('items/:itemId/annotations/:annotationId')
  async removeAnnotation(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Param('annotationId') id: string) {
    const a = await this.annotation(workspaceId, u, itemId, id);
    await this.prisma.annotation.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
  }

  private async annotation(workspaceId: string, u: AuthUser, itemId: string, id: string) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    if (!isUuid(id)) throw new NotFoundException();
    const a = await this.prisma.annotation.findFirst({ where: { id, itemId: item.id, userId: u.id, deletedAt: null } });
    if (!a) throw new NotFoundException('Annotation not found');
    return a;
  }

  @Get('items/:itemId/bookmarks')
  async bookmarks(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    return this.prisma.bookmark.findMany({ where: { itemId: item.id, userId: u.id }, orderBy: { createdAt: 'asc' } });
  }

  @Post('items/:itemId/bookmarks')
  async createBookmark(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Body() dto: CreateBookmarkDto) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    const locator = cleanLocator(dto.locator);
    return this.prisma.bookmark.create({
      data: { id: newId(), workspaceId, userId: u.id, itemId: item.id, locator: locator as any, label: dto.label?.trim() || locator.title || '' },
    });
  }

  @HttpCode(204)
  @Delete('items/:itemId/bookmarks/:bookmarkId')
  async removeBookmark(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Param('bookmarkId') id: string) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    if (!isUuid(id)) throw new NotFoundException();
    const { count } = await this.prisma.bookmark.deleteMany({ where: { id, itemId: item.id, userId: u.id } });
    if (!count) throw new NotFoundException('Bookmark not found');
  }

  /**
   * Explains, defines, summarizes or answers a question about a passage. The locator fixes the reader's position:
   * the run only sees the book up to the end of the passage. A locator that cannot be placed is rejected.
   */
  @RequireRole('EDITOR')
  @Post('items/:itemId/explain')
  async explain(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Body() dto: ExplainDto) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    const source = await this.library.source(workspaceId, item.sourceId);
    if (!source?.currentVersionId) throw new BadRequestException({ message: 'This book has no readable file', code: 'NO_FILE' });
    if (dto.mode === 'ask' && !dto.question?.trim()) throw new BadRequestException({ message: 'Ask needs a question', code: 'VALIDATION' });
    const chapters = await this.library.chapters(source.currentVersionId);
    const locator = cleanLocator(dto.locator);
    const page = pageForLocator(chapters, locator);
    if (!page) throw new BadRequestException({ message: 'The passage position could not be placed in the book', code: 'LOCATOR_UNKNOWN' });
    const chapterTitle = chapters.find((c) => c.page === page)?.title ?? null;
    const passage = dto.passage.trim();
    const question = dto.question?.trim() || undefined;
    const run = await this.runs.create(workspaceId, u, {
      graph: 'passage_explain',
      input: { text: passage, question, params: { passage, question, mode: dto.mode, page, chapterTitle, itemId: item.id } },
      scope: { sourceVersionIds: [source.currentVersionId] },
    });
    return { ...run, page, chapterTitle };
  }

  /** Saves a passage as an excerpt; Writer research notes can quote it and link back to this position. */
  @RequireRole('EDITOR')
  @Post('items/:itemId/excerpts')
  async excerpt(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Body() dto: ReaderExcerptDto) {
    const item = await this.library.item(workspaceId, u.id, itemId);
    const source = await this.library.source(workspaceId, item.sourceId);
    const chapters = await this.library.chapters(source?.currentVersionId);
    const locator = cleanLocator(dto.locator);
    const page = pageForLocator(chapters, locator);
    return this.prisma.excerpt.create({
      data: {
        id: newId(),
        workspaceId,
        sourceId: source?.id ?? null,
        sourceVersionId: source?.currentVersionId ?? null,
        projectId: source?.projectId ?? null,
        title: item.book.title,
        quote: dto.quote,
        anchor: { itemId: item.id, locator, page, chapterTitle: chapters.find((c) => c.page === page)?.title ?? null } as any,
        createdById: u.id,
      },
    });
  }

  @Get('collections')
  async collections(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser) {
    const rows = await this.prisma.collection.findMany({ where: { workspaceId, userId: u.id }, include: { _count: { select: { items: true } } }, orderBy: { name: 'asc' } });
    return rows.map(({ _count, ...c }) => ({ ...c, itemCount: _count.items }));
  }

  @Post('collections')
  async createCollection(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: CollectionDto) {
    const name = dto.name.trim();
    if (await this.prisma.collection.findFirst({ where: { workspaceId, userId: u.id, name } })) {
      throw new ConflictException({ message: 'A collection with this name exists', code: 'DUPLICATE' });
    }
    return this.prisma.collection.create({ data: { id: newId(), workspaceId, userId: u.id, name, description: dto.description ?? '' } });
  }

  @Patch('collections/:collectionId')
  async updateCollection(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('collectionId') id: string, @Body() dto: UpdateCollectionDto) {
    const c = await this.collection(workspaceId, u, id);
    const name = dto.name?.trim();
    if (name && name !== c.name && (await this.prisma.collection.findFirst({ where: { workspaceId, userId: u.id, name } }))) {
      throw new ConflictException({ message: 'A collection with this name exists', code: 'DUPLICATE' });
    }
    return this.prisma.collection.update({ where: { id: c.id }, data: { ...(name ? { name } : {}), ...(dto.description !== undefined ? { description: dto.description } : {}) } });
  }

  @HttpCode(204)
  @Delete('collections/:collectionId')
  async removeCollection(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('collectionId') id: string) {
    const c = await this.collection(workspaceId, u, id);
    await this.prisma.collection.delete({ where: { id: c.id } });
  }

  @HttpCode(204)
  @Post('collections/:collectionId/items')
  async addToCollection(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('collectionId') id: string, @Body() dto: CollectionItemDto) {
    const c = await this.collection(workspaceId, u, id);
    const item = await this.library.item(workspaceId, u.id, dto.itemId);
    await this.prisma.collectionItem.upsert({
      where: { collectionId_itemId: { collectionId: c.id, itemId: item.id } },
      create: { collectionId: c.id, itemId: item.id },
      update: {},
    });
  }

  @HttpCode(204)
  @Delete('collections/:collectionId/items/:itemId')
  async removeFromCollection(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('collectionId') id: string, @Param('itemId') itemId: string) {
    const c = await this.collection(workspaceId, u, id);
    if (!isUuid(itemId)) throw new NotFoundException();
    await this.prisma.collectionItem.deleteMany({ where: { collectionId: c.id, itemId } });
  }

  private async collection(workspaceId: string, u: AuthUser, id: string) {
    if (!isUuid(id)) throw new NotFoundException();
    const c = await this.prisma.collection.findFirst({ where: { id, workspaceId, userId: u.id } });
    if (!c) throw new NotFoundException('Collection not found');
    return c;
  }

  @Get('stats')
  stats(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser) {
    return this.library.stats(workspaceId, u.id);
  }

  /** Optional metadata lookup. `enabled: false` means no provider is configured: use manual entry. */
  @Get('metadata/search')
  searchMetadata(@Query('q') q = '') {
    return this.metadata.search(q);
  }
}
