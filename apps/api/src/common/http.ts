import type { Request, Response } from 'express';
import { env } from '../config/env';

export const clientIp = (req: Request) => (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;

export interface CookieSet {
  access: string;
  refresh: string;
  csrf: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
}

export function setAuthCookies(res: Response, c: CookieSet) {
  const secure = env().COOKIE_SECURE;
  res.cookie('fv_at', c.access, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: c.accessMaxAgeMs });
  res.cookie('fv_rt', c.refresh, { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth', maxAge: c.refreshMaxAgeMs });
  res.cookie('fv_csrf', c.csrf, { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge: c.refreshMaxAgeMs });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie('fv_at', { path: '/' });
  res.clearCookie('fv_rt', { path: '/api/auth' });
  res.clearCookie('fv_csrf', { path: '/' });
}

/** Pagination helper: cursor = last id seen (UUIDv7 ids sort by creation time). */
export function page(limit?: string | number, max = 100) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), max);
  return n;
}
