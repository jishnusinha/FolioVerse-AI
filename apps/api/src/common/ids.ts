import { uuidv7 } from 'uuidv7';
import { createHash, randomBytes } from 'node:crypto';

export const newId = (): string => uuidv7();

export const sha256Hex = (input: string | Buffer): string => createHash('sha256').update(input).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
