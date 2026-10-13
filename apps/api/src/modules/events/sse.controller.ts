import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { annotate, FV_ATTR, fvMetrics } from '../../infra/observability';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService, RUN_STREAM, WS_STREAM } from '../../infra/redis.service';
import { RunsService, TERMINAL } from '../runs/runs.service';

const STREAM_ID = /^\d+-\d+$/;
const FINAL_TYPES = new Set(['run.finished', 'run.failed']);

function openSse(res: Response, stream: 'run' | 'workspace') {
  const open = fvMetrics().sseConnections;
  open.add(1, { stream });
  res.once('close', () => open.add(-1, { stream }));
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 2000\n\n');
}

function writeEvent(res: Response, id: string, env: any) {
  fvMetrics().sseEvents.add(1, { type: String(env.type) });
  res.write(`id: ${id}\nevent: ${env.type}\ndata: ${JSON.stringify({ ...env, id })}\n\n`);
}

/**
 * Server-Sent Events backed by Redis Streams. Clients resume with Last-Event-ID (or ?lastEventId=)
 * and receive every event after that id exactly once.
 */
@ApiTags('events')
@Controller('workspaces/:workspaceId')
export class SseController {
  constructor(
    private readonly redis: RedisService,
    private readonly runs: RunsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('runs/:runId/events')
  async runEvents(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @Req() req: Request, @Res() res: Response) {
    const run = await this.runs.getRun(workspaceId, runId);
    const requested = (req.headers['last-event-id'] as string) || (req.query.lastEventId as string) || '0-0';
    let cursor = STREAM_ID.test(requested) ? requested : '0-0';
    const stream = RUN_STREAM(runId);
    annotate({ [FV_ATTR.workspaceId]: workspaceId, [FV_ATTR.runId]: runId, [FV_ATTR.graph]: run.graph });
    openSse(res, 'run');

    const exists = await this.redis.client.exists(stream);
    if (!exists && TERMINAL.has(run.status)) {
      // Live stream expired (or never existed, e.g. budget rejection): replay persisted milestones.
      const events = await this.prisma.aiRunEvent.findMany({ where: { runId }, orderBy: { seq: 'asc' } });
      for (const e of events) writeEvent(res, `p-${e.seq}`, { schemaVersion: 1, type: e.type, seq: e.seq, ts: e.ts, runId, data: e.data });
      if (!events.some((e) => FINAL_TYPES.has(e.type))) {
        writeEvent(res, 'p-final', {
          schemaVersion: 1,
          type: 'run.finished',
          seq: run.lastSeq + 1,
          ts: new Date().toISOString(),
          runId,
          data: { status: run.status, outcome: run.outcome ?? 'PARTIAL', answer: (run.result as any)?.answer ?? '', error: run.error },
        });
      }
      res.end();
      return;
    }

    const client = this.redis.blockingClient();
    let closed = false;
    req.on('close', () => {
      closed = true;
      this.redis.release(client);
    });
    let idle = 0;
    while (!closed) {
      let r: any;
      try {
        r = await client.xread('COUNT', 200, 'BLOCK', 15000, 'STREAMS', stream, cursor);
      } catch {
        break;
      }
      if (!r) {
        res.write(': ping\n\n');
        idle += 1;
        const cur = await this.prisma.aiRun.findUnique({ where: { id: runId }, select: { status: true } });
        if (cur && TERMINAL.has(cur.status) && idle >= 2) break;
        continue;
      }
      idle = 0;
      let done = false;
      for (const [, entries] of r) {
        for (const [id, fields] of entries as [string, string[]][]) {
          const env = JSON.parse(fields[1]);
          writeEvent(res, id, env);
          cursor = id;
          if (FINAL_TYPES.has(env.type)) done = true;
        }
      }
      if (done) break;
    }
    if (!closed) {
      this.redis.release(client);
      res.end();
    }
  }

  @Get('events')
  async workspaceEvents(@Param('workspaceId') workspaceId: string, @Req() req: Request, @Res() res: Response) {
    const stream = WS_STREAM(workspaceId);
    const requested = (req.headers['last-event-id'] as string) || (req.query.lastEventId as string);
    let cursor: string;
    if (requested && STREAM_ID.test(requested)) cursor = requested;
    else {
      const last = await this.redis.client.xrevrange(stream, '+', '-', 'COUNT', 1);
      cursor = last.length ? last[0][0] : '0-0';
    }
    annotate({ [FV_ATTR.workspaceId]: workspaceId });
    openSse(res, 'workspace');
    const client = this.redis.blockingClient();
    let closed = false;
    req.on('close', () => {
      closed = true;
      this.redis.release(client);
    });
    while (!closed) {
      let r: any;
      try {
        r = await client.xread('COUNT', 200, 'BLOCK', 20000, 'STREAMS', stream, cursor);
      } catch {
        break;
      }
      if (!r) {
        res.write(': ping\n\n');
        continue;
      }
      for (const [, entries] of r) {
        for (const [id, fields] of entries as [string, string[]][]) {
          writeEvent(res, id, JSON.parse(fields[1]));
          cursor = id;
        }
      }
    }
  }
}
