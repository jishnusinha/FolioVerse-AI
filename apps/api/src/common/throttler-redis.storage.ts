import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

// KEYS: hits, block. ARGV: ttlMs, limit, blockMs. Returns {hits, hitsPttl, blockPttl}.
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local block = redis.call('PTTL', KEYS[2])
if block <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  block = tonumber(ARGV[3])
end
return {hits, ttl, block}
`;

/** Rate-limit counters shared by every API replica. */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'fv:throttle',
  ) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const base = `${this.prefix}:${throttlerName}:${key}`;
    const [hits, ttlMs, blockMs] = (await this.redis.eval(SCRIPT, 2, `${base}:h`, `${base}:b`, ttl, limit, blockDuration || ttl)) as number[];
    const isBlocked = blockMs > 0;
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(blockMs / 1000) : 0,
    };
  }
}
