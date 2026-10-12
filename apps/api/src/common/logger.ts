import { LoggerService } from '@nestjs/common';
import pino from 'pino';

/** Paths that must never reach logs: credentials, cookies and private source content. */
export const REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'req.headers.cookie',
  'req.headers.authorization',
  'headers.cookie',
  'headers.authorization',
  'apiKey',
  '*.apiKey',
  'content',
  '*.content',
  'text',
  '*.text',
];

export const rootLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.FV_SERVICE_NAME || 'api' },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export class PinoNestLogger implements LoggerService {
  log(message: any, context?: string) {
    rootLogger.info({ context }, String(message));
  }
  error(message: any, trace?: string, context?: string) {
    rootLogger.error({ context, trace }, String(message));
  }
  warn(message: any, context?: string) {
    rootLogger.warn({ context }, String(message));
  }
  debug(message: any, context?: string) {
    rootLogger.debug({ context }, String(message));
  }
  verbose(message: any, context?: string) {
    rootLogger.trace({ context }, String(message));
  }
}
