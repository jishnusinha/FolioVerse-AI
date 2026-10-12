import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/** Renders every error as RFC 9457 application/problem+json. Internal details are never leaked. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (res.headersSent) return;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let errors: unknown;
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        title = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, any>;
        title = b.error || exception.name;
        if (Array.isArray(b.message)) {
          errors = b.message;
          detail = 'Validation failed';
        } else {
          detail = b.message;
        }
        code = b.code;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        status = 404;
        title = 'Not Found';
      } else if (exception.code === 'P2002') {
        status = 409;
        title = 'Conflict';
        detail = 'Resource already exists';
      } else {
        this.log.error(`Prisma ${exception.code} on ${req.method} ${req.path}`);
      }
    } else {
      this.log.error(`Unhandled error on ${req.method} ${req.path}: ${(exception as Error)?.message}`, (exception as Error)?.stack);
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title, status, detail, code, errors, instance: req.originalUrl });
  }
}
