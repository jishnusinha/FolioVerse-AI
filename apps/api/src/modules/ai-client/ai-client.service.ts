import { Global, Injectable, Module } from '@nestjs/common';
import { env } from '../../config/env';
import { CryptoService } from '../../common/crypto.service';
import { traceHeaders } from '../../infra/observability';

export class AiServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function parseLine(line: string) {
  try {
    return JSON.parse(line);
  } catch {
    throw new AiServiceError('AI service sent a malformed NDJSON line', 0, false);
  }
}

export interface StreamOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  traceparent?: string;
}

/**
 * Client for bounded, held-open work units on the AI service. The response body is NDJSON:
 * one EventEnvelope per line. Lines are yielded as parsed objects as soon as they arrive.
 */
@Injectable()
export class AiClientService {
  constructor(private readonly crypto: CryptoService) {}

  async *stream(base: 'api' | 'ingest', path: string, body: unknown, opts: StreamOptions = {}): AsyncGenerator<any> {
    const url = `${base === 'api' ? env().FV_AI_API_URL : env().FV_AI_INGEST_URL}${path}`;
    const token = await this.crypto.signInternal('api-worker', 600);
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 300_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
          authorization: `Bearer ${token}`,
          ...traceHeaders(),
          ...(opts.traceparent ? { traceparent: opts.traceparent } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      throw new AiServiceError(`AI service unreachable: ${(e as Error).message}`, 0, true);
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new AiServiceError(`AI service responded ${res.status}: ${text.slice(0, 300)}`, res.status, res.status >= 500 || res.status === 429);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        const timedOut = timeout.aborted;
        throw new AiServiceError(timedOut ? 'AI service work unit timed out' : `AI service stream broke: ${(e as Error).message}`, 0, true);
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield parseLine(line);
      }
    }
    const tail = buf.trim();
    if (tail) yield parseLine(tail);
  }

  async json<T = any>(path: string, init: { method?: string; body?: unknown } = {}, base: 'api' | 'ingest' = 'api'): Promise<T> {
    const url = `${base === 'api' ? env().FV_AI_API_URL : env().FV_AI_INGEST_URL}${path}`;
    const token = await this.crypto.signInternal('api-http', 120);
    const res = await fetch(url, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...traceHeaders() },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new AiServiceError(`AI service responded ${res.status}`, res.status, res.status >= 500);
    return (await res.json()) as T;
  }
}

@Global()
@Module({ providers: [AiClientService], exports: [AiClientService] })
export class AiClientModule {}
