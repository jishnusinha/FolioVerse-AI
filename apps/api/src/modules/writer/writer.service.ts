import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, RevisionOrigin } from '@prisma/client';
import { reanchor } from '../../common/anchors';
import { isUuid, newId, sha256Hex } from '../../common/ids';
import { rootLogger } from '../../common/logger';
import { PrismaService } from '../../infra/prisma.service';
import { blockContaining, blocksOf, countWords, docText, emptyDoc, proseBlocks, type PMNode, validateDoc } from './doc';

/** Graphs whose results the writer records (suggestions, continuity issues, DNA proposals). */
export const WRITER_GRAPHS = new Set(['writer_revision', 'continuity_check', 'dna_extraction']);

/** Consecutive author saves within this window update the latest AUTHOR snapshot instead of adding one. */
export const SNAPSHOT_WINDOW_MS = 5 * 60_000;

export const REVISION_MODES: Record<string, string> = {
  rewrite: 'Rewrite for clarity and vividness, keeping meaning, POV and tense.',
  expand: 'Expand with sensory detail and interiority.',
  shorten: 'Tighten to about 60% of the length, keeping the key beats.',
  tone: 'Rewrite in a different tone.',
  dialogue: 'Make the dialogue more natural, with distinct voices.',
  continue: 'Continue the scene in the same voice.',
};

export interface SaveDocInput {
  content: unknown;
  revision: number;
  /** `accept` applies a suggestion variant; `undo` reverts an accepted suggestion. */
  action?: 'accept' | 'undo';
  suggestionId?: string;
  variant?: number;
}

export interface Evidence {
  nodeId: string;
  blockId?: string | null;
  quote: string;
  state?: string;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const today = () => new Date(new Date().toISOString().slice(0, 10));
const sameDay = (a: Date | null, b: Date) => !!a && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

@Injectable()
export class WriterService {
  constructor(private readonly prisma: PrismaService) {}

  async manuscript(workspaceId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException();
    const m = await this.prisma.manuscript.findFirst({ where: { id, workspaceId, deletedAt: null } });
    if (!m) throw new NotFoundException('Manuscript not found');
    return m;
  }

  async node(workspaceId: string, manuscriptId: string, nodeId: string) {
    if (!isUuid(nodeId)) throw new NotFoundException();
    const n = await this.prisma.manuscriptNode.findFirst({ where: { id: nodeId, manuscriptId, workspaceId } });
    if (!n) throw new NotFoundException('Scene not found');
    return n;
  }

  async scene(workspaceId: string, manuscriptId: string, nodeId: string) {
    const n = await this.node(workspaceId, manuscriptId, nodeId);
    if (n.kind !== 'SCENE') throw new BadRequestException({ message: 'Only scenes have text', code: 'NOT_A_SCENE' });
    return n;
  }

  /** The scene's document, created empty on first access. */
  async doc(workspaceId: string, manuscriptId: string, nodeId: string) {
    const n = await this.scene(workspaceId, manuscriptId, nodeId);
    const existing = await this.prisma.richDoc.findUnique({ where: { nodeId: n.id } });
    if (existing) return existing;
    return this.prisma.richDoc.create({ data: { id: newId(), workspaceId, manuscriptId, nodeId: n.id, content: emptyDoc() as any } });
  }

  async stats(manuscriptId: string) {
    const m = await this.prisma.manuscript.findUniqueOrThrow({ where: { id: manuscriptId } });
    const agg = await this.prisma.manuscriptNode.aggregate({ where: { manuscriptId, kind: 'SCENE' }, _sum: { wordCount: true } });
    const words = agg._sum.wordCount ?? 0;
    return { words, todayWords: sameDay(m.dayStart, today()) ? Math.max(0, words - m.dayStartWords) : 0, dailyGoal: m.dailyGoal };
  }

  /**
   * Saves a scene. `revision` must equal the stored revision (optimistic concurrency) or the save fails with
   * 409 REVISION_CONFLICT carrying the saved version. Pending suggestions whose paragraph changed become STALE.
   */
  async saveDoc(workspaceId: string, userId: string, manuscriptId: string, nodeId: string, input: SaveDocInput, opts: { restoreOf?: number } = {}) {
    const content = validateDoc(input.content);
    if (!Number.isInteger(input.revision)) throw new BadRequestException({ message: 'revision is required', code: 'VALIDATION' });
    const doc = await this.doc(workspaceId, manuscriptId, nodeId);
    const result = await this.prisma.$transaction(async (tx) => {
      const cur = await tx.richDoc.findUniqueOrThrow({ where: { id: doc.id } });
      const conflict = () =>
        new ConflictException({
          message: 'This scene was changed elsewhere since you loaded it',
          code: 'REVISION_CONFLICT',
          current: { revision: cur.revision, content: cur.content, text: cur.text, updatedAt: cur.updatedAt },
        });
      if (cur.revision !== input.revision) throw conflict();

      const before = new Map(blocksOf(cur.content as unknown as PMNode).map((b) => [b.blockId, b.text]));
      const after = new Map(blocksOf(content).map((b) => [b.blockId, b.text]));
      let origin: RevisionOrigin = opts.restoreOf !== undefined ? 'RESTORE' : 'AUTHOR';
      let decided: { id: string; data: Prisma.SuggestionUpdateInput } | null = null;

      if (input.action) {
        if (!isUuid(input.suggestionId)) throw new NotFoundException('Suggestion not found');
        const s = await tx.suggestion.findFirst({ where: { id: input.suggestionId, docId: doc.id, workspaceId } });
        if (!s) throw new NotFoundException('Suggestion not found');
        const variants = (s.variants as any[]) ?? [];
        if (input.action === 'accept') {
          if (s.state !== 'PENDING') throw new ConflictException({ message: `This suggestion is ${s.state.toLowerCase()}`, code: 'SUGGESTION_NOT_PENDING' });
          const v = variants[input.variant ?? 0];
          if (!v?.text) throw new BadRequestException({ message: 'Unknown variant', code: 'UNKNOWN_VARIANT' });
          if (squash(before.get(s.blockId) ?? '') !== squash(s.baseText)) {
            await tx.suggestion.update({ where: { id: s.id }, data: { state: 'STALE' } });
            throw new ConflictException({ message: 'The paragraph changed after this suggestion was generated', code: 'SUGGESTION_STALE' });
          }
          if (squash(after.get(s.blockId) ?? '') !== squash(v.text)) {
            throw new BadRequestException({ message: 'The saved paragraph does not match the accepted variant', code: 'VARIANT_MISMATCH' });
          }
          origin = 'POST_AI';
          decided = { id: s.id, data: { state: 'ACCEPTED', chosen: input.variant ?? 0, decidedAt: new Date() } };
        } else {
          if (s.state !== 'ACCEPTED') throw new ConflictException({ message: 'Only an accepted suggestion can be undone', code: 'SUGGESTION_NOT_ACCEPTED' });
          if (squash(after.get(s.blockId) ?? '') !== squash(s.baseText)) {
            throw new BadRequestException({ message: 'The saved paragraph does not match the original text', code: 'VARIANT_MISMATCH' });
          }
          origin = 'UNDO';
          decided = { id: s.id, data: { state: 'PENDING', chosen: null, appliedRevision: null, decidedAt: null } };
        }
      }

      const text = docText(content);
      const wordCount = countWords(text);
      const revision = cur.revision + 1;
      const updated = await tx.richDoc.updateMany({
        where: { id: doc.id, revision: input.revision },
        data: { content: content as any, text, wordCount, revision, updatedById: userId },
      });
      if (updated.count !== 1) throw conflict();
      const note = opts.restoreOf !== undefined ? `Restored r${opts.restoreOf}` : undefined;
      await this.snapshot(tx, { workspaceId, docId: doc.id, revision, origin, content, text, wordCount, userId, note });

      if (decided) {
        await tx.suggestion.update({ where: { id: decided.id }, data: { ...decided.data, ...(origin === 'POST_AI' ? { appliedRevision: revision } : {}) } });
      }
      const pending = await tx.suggestion.findMany({ where: { docId: doc.id, state: 'PENDING', ...(decided ? { id: { not: decided.id } } : {}) } });
      const stale = pending.filter((s) => squash(after.get(s.blockId) ?? '\u0000') !== squash(s.baseText)).map((s) => s.id);
      if (stale.length) await tx.suggestion.updateMany({ where: { id: { in: stale } }, data: { state: 'STALE' } });

      const m = await tx.manuscript.findUniqueOrThrow({ where: { id: manuscriptId } });
      const sum = await tx.manuscriptNode.aggregate({ where: { manuscriptId, kind: 'SCENE' }, _sum: { wordCount: true } });
      const totalBefore = sum._sum.wordCount ?? 0;
      if (!sameDay(m.dayStart, today())) {
        await tx.manuscript.update({ where: { id: manuscriptId }, data: { dayStart: today(), dayStartWords: totalBefore } });
      }
      await tx.manuscriptNode.update({ where: { id: nodeId }, data: { wordCount } });
      return { revision, wordCount, origin, staleSuggestionIds: stale, savedAt: new Date() };
    });
    return { ...result, stats: await this.stats(manuscriptId) };
  }

  private async snapshot(
    tx: Prisma.TransactionClient,
    s: { workspaceId: string; docId: string; revision: number; origin: RevisionOrigin; content: PMNode; text: string; wordCount: number; userId: string; note?: string },
  ) {
    const last = await tx.docRevision.findFirst({ where: { docId: s.docId }, orderBy: { revision: 'desc' } });
    const data = { revision: s.revision, content: s.content as any, text: s.text, wordCount: s.wordCount };
    if (s.origin === 'AUTHOR' && last?.origin === 'AUTHOR' && last.createdById === s.userId && Date.now() - last.createdAt.getTime() < SNAPSHOT_WINDOW_MS) {
      await tx.docRevision.update({ where: { id: last.id }, data });
      return;
    }
    await tx.docRevision.create({ data: { id: newId(), workspaceId: s.workspaceId, docId: s.docId, origin: s.origin, note: s.note ?? null, createdById: s.userId, ...data } });
  }

  /** Restores a snapshot as a new RESTORE revision (the same concurrency rule as a save). */
  async restore(workspaceId: string, userId: string, manuscriptId: string, nodeId: string, snapshotRevision: number, baseRevision: number) {
    const doc = await this.doc(workspaceId, manuscriptId, nodeId);
    const snap = await this.prisma.docRevision.findFirst({ where: { docId: doc.id, revision: snapshotRevision } });
    if (!snap) throw new NotFoundException('Revision not found');
    return this.saveDoc(workspaceId, userId, manuscriptId, nodeId, { content: snap.content, revision: baseRevision }, { restoreOf: snapshotRevision });
  }

  /** Scene documents of a manuscript keyed by node id. */
  async docsByNode(manuscriptId: string, nodeIds?: string[]) {
    const docs = await this.prisma.richDoc.findMany({ where: { manuscriptId, ...(nodeIds ? { nodeId: { in: nodeIds } } : {}) } });
    return new Map(docs.map((d) => [d.nodeId, d.content as unknown as PMNode]));
  }

  /** Re-resolves a manuscript anchor against the current scene text (EXACT, SHIFTED, FUZZY or ORPHANED). */
  resolveEvidence(docs: Map<string, PMNode>, ev: Evidence): Evidence {
    const doc = docs.get(ev.nodeId);
    if (!doc || !ev.quote) return { ...ev, state: 'ORPHANED' };
    const blocks = proseBlocks(doc);
    const own = blocks.find((b) => b.blockId === ev.blockId);
    if (own?.text.includes(ev.quote)) return { ...ev, state: 'EXACT' };
    const moved = blocks.find((b) => b.text.includes(ev.quote));
    if (moved) return { ...ev, blockId: moved.blockId, state: 'SHIFTED' };
    for (const b of own ? [own, ...blocks.filter((x) => x !== own)] : blocks) {
      const r = reanchor(b.text, { textQuote: { exact: ev.quote } });
      if (r.state === 'FUZZY') return { ...ev, blockId: b.blockId, quote: b.text.slice(r.start, r.end), state: 'FUZZY' };
    }
    return { ...ev, state: 'ORPHANED' };
  }

  /** Canon facts grouped per subject, in the shape the continuity graph expects. */
  async canon(manuscriptId: string) {
    const facts = await this.prisma.dnaFact.findMany({ where: { manuscriptId, status: 'CANON' }, orderBy: { createdAt: 'asc' } });
    const by = new Map<string, { id: string; name: string; facts: Record<string, string> }>();
    for (const f of facts) {
      const e = by.get(f.subject.toLowerCase()) ?? { id: f.id, name: f.subject, facts: {} };
      if (f.predicate && f.value) e.facts[f.predicate] = f.value;
      by.set(f.subject.toLowerCase(), e);
    }
    return { entities: [...by.values()], facts };
  }

  /** Applies a finished writer run. Only rows the run was created for (same workspace) are touched. */
  async recordFromRun(runId: string, artifact: Record<string, any> | null) {
    const run = await this.prisma.aiRun.findUnique({ where: { id: runId } });
    if (!run || !artifact || !WRITER_GRAPHS.has(run.graph)) return;
    const params = ((run.input as any)?.params ?? {}) as Record<string, any>;
    try {
      if (run.graph === 'writer_revision') await this.recordRevision(run, params, artifact);
      else if (run.graph === 'continuity_check') await this.recordContinuity(run, params, artifact);
      else await this.recordDna(run, params, artifact);
    } catch (e) {
      rootLogger.error({ runId, err: (e as Error).message }, 'writer result not recorded');
    }
  }

  private async recordRevision(run: { id: string; workspaceId: string; isDemo: boolean }, params: Record<string, any>, artifact: Record<string, any>) {
    if (!isUuid(params.suggestionId)) return;
    const variants = (Array.isArray(artifact.variants) ? artifact.variants : [])
      .filter((v: any) => v && typeof v.text === 'string' && v.text.trim())
      .slice(0, 3)
      .map((v: any) => ({ text: String(v.text).slice(0, 20_000), rationale: String(v.rationale ?? '').slice(0, 500) }));
    await this.prisma.suggestion.updateMany({
      where: { id: params.suggestionId, runId: run.id, workspaceId: run.workspaceId },
      data: { variants: variants as any, fallback: Boolean(artifact.fallback), isDemo: run.isDemo },
    });
  }

  private async recordContinuity(run: { id: string; workspaceId: string; isDemo: boolean }, params: Record<string, any>, artifact: Record<string, any>) {
    if (!isUuid(params.manuscriptId) || !isUuid(params.nodeId)) return;
    const m = await this.prisma.manuscript.findFirst({ where: { id: params.manuscriptId, workspaceId: run.workspaceId } });
    const node = m && (await this.prisma.manuscriptNode.findFirst({ where: { id: params.nodeId, manuscriptId: m.id } }));
    if (!m || !node) return;
    const doc = (await this.docsByNode(m.id, [node.id])).get(node.id);
    const { facts } = await this.canon(m.id);
    const seen = new Set<string>();
    for (const issue of Array.isArray(artifact.issues) ? artifact.issues.slice(0, 50) : []) {
      if (!issue?.quote || !issue.entity) continue;
      const quote = String(issue.quote).slice(0, 1000);
      const fingerprint = sha256Hex([node.id, issue.entity, issue.fact, issue.found, squash(quote).toLowerCase()].join('|')).slice(0, 40);
      seen.add(fingerprint);
      const fact = facts.find((f) => f.subject.toLowerCase() === String(issue.entity).toLowerCase() && (f.predicate ?? '') === String(issue.fact ?? ''));
      const block = doc ? blockContaining(doc, quote) : null;
      const canonEvidence = ((fact?.evidence as any[]) ?? [])[0];
      const anchors = [
        { role: 'scene', nodeId: node.id, blockId: block?.blockId ?? null, quote },
        { role: 'canon', factId: fact?.id ?? null, statement: fact?.statement ?? `${issue.entity}: ${issue.fact} is ${issue.expected}`, ...(canonEvidence ?? {}) },
      ];
      const existing = await this.prisma.continuityIssue.findUnique({ where: { manuscriptId_fingerprint: { manuscriptId: m.id, fingerprint } } });
      if (existing) {
        if (existing.state === 'RESOLVED') {
          await this.prisma.continuityIssue.update({ where: { id: existing.id }, data: { state: 'OPEN', runId: run.id, anchors, blockId: block?.blockId ?? null, decidedAt: null, decidedById: null } });
        }
        continue;
      }
      await this.prisma.continuityIssue.create({
        data: {
          id: newId(),
          workspaceId: run.workspaceId,
          manuscriptId: m.id,
          nodeId: node.id,
          blockId: block?.blockId ?? null,
          runId: run.id,
          factId: fact?.id ?? null,
          entity: String(issue.entity).slice(0, 200),
          fact: String(issue.fact ?? '').slice(0, 200),
          expected: String(issue.expected ?? '').slice(0, 500),
          found: String(issue.found ?? '').slice(0, 500),
          quote,
          severity: ['HIGH', 'MEDIUM', 'LOW'].includes(issue.severity) ? issue.severity : 'MEDIUM',
          anchors,
          fingerprint,
          isDemo: run.isDemo,
        },
      });
    }
    // Issues this check no longer finds in the scene were fixed in the text.
    await this.prisma.continuityIssue.updateMany({
      where: { manuscriptId: m.id, nodeId: node.id, state: 'OPEN', fingerprint: { notIn: [...seen] } },
      data: { state: 'RESOLVED', decidedAt: new Date() },
    });
  }

  private async recordDna(run: { id: string; workspaceId: string; isDemo: boolean }, params: Record<string, any>, artifact: Record<string, any>) {
    if (!isUuid(params.manuscriptId)) return;
    const m = await this.prisma.manuscript.findFirst({ where: { id: params.manuscriptId, workspaceId: run.workspaceId } });
    if (!m) return;
    const nodeIds: string[] = (Array.isArray(params.nodeIds) ? params.nodeIds : []).filter(isUuid);
    const docs = await this.docsByNode(m.id, nodeIds.length ? nodeIds : undefined);
    const locate = (quote: string): Evidence[] => {
      if (!quote) return [];
      for (const [nodeId, doc] of docs) {
        const b = blockContaining(doc, quote);
        if (b) return [{ nodeId, blockId: b.blockId, quote: quote.slice(0, 500), state: 'EXACT' }];
      }
      return [];
    };
    /** The first sentence naming both the subject and the value. */
    const locateFact = (name: string, value: string): Evidence[] | null => {
      const [n, v] = [name.toLowerCase(), value.toLowerCase()];
      for (const [nodeId, doc] of docs) {
        for (const b of proseBlocks(doc)) {
          const sentence = b.text.split(/(?<=[.!?])\s+/).find((s) => s.toLowerCase().includes(n) && s.toLowerCase().includes(v));
          if (sentence) return [{ nodeId, blockId: b.blockId, quote: sentence.slice(0, 500), state: 'EXACT' }];
        }
      }
      return null;
    };
    const existing = await this.prisma.dnaFact.findMany({ where: { manuscriptId: m.id } });
    const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
    const base = { workspaceId: run.workspaceId, manuscriptId: m.id, status: 'PROPOSED' as const, origin: 'AI_EXTRACTED' as const, runId: run.id, isDemo: run.isDemo };
    const KINDS = new Set(['CHARACTER', 'PLACE', 'OBJECT', 'THEME', 'EVENT']);
    for (const e of Array.isArray(artifact.entities) ? artifact.entities.slice(0, 60) : []) {
      const name = String(e?.name ?? '').trim().slice(0, 120);
      if (!name) continue;
      const kind = KINDS.has(String(e.kind)) ? String(e.kind) : 'CHARACTER';
      const evidence = locate(String(e.evidence ?? ''));
      const confidence = Math.min(0.95, 0.5 + Number(e.mentions ?? 1) * 0.05);
      const same = existing.filter((f) => key(f.subject) === key(name));
      if (!same.some((f) => !f.predicate)) {
        const row = await this.prisma.dnaFact.create({
          data: { id: newId(), ...base, subject: name, subjectKind: kind, statement: `${name} is a ${kind.toLowerCase()} in the story.`, confidence, evidence: evidence as any },
        });
        existing.push(row);
      }
      for (const [predicate, value] of Object.entries((e.facts ?? {}) as Record<string, unknown>).slice(0, 20)) {
        const v = String(value).slice(0, 200);
        if (same.some((f) => key(f.predicate) === key(predicate) && key(f.value) === key(v))) continue;
        const canon = same.find((f) => f.status === 'CANON' && key(f.predicate) === key(predicate));
        const row = await this.prisma.dnaFact.create({
          data: {
            id: newId(),
            ...base,
            subject: name,
            subjectKind: kind,
            predicate: predicate.slice(0, 120),
            value: v,
            statement: `${name}: ${predicate} is ${v}.`,
            confidence,
            evidence: (locateFact(name, v) ?? evidence) as any,
            note: canon ? `Differs from canon (${canon.value})` : null,
          },
        });
        existing.push(row);
      }
    }
    const links = await this.prisma.dnaLink.findMany({ where: { manuscriptId: m.id } });
    for (const r of Array.isArray(artifact.relations) ? artifact.relations.slice(0, 80) : []) {
      const [a, b] = [String(r?.a ?? '').trim(), String(r?.b ?? '').trim()];
      if (!a || !b || key(a) === key(b)) continue;
      const kind = String(r.kind ?? 'APPEARS_WITH').slice(0, 60);
      const dup = links.some((l) => l.kind === kind && ((key(l.source) === key(a) && key(l.target) === key(b)) || (key(l.source) === key(b) && key(l.target) === key(a))));
      if (dup) continue;
      const row = await this.prisma.dnaLink.create({
        data: { id: newId(), ...base, source: a.slice(0, 120), target: b.slice(0, 120), kind, label: kind === 'APPEARS_WITH' ? 'appears with' : kind.toLowerCase(), weight: Math.max(1, Math.min(99, Number(r.weight) || 1)) },
      });
      links.push(row);
    }
  }
}
