import { Global, Injectable, Module } from '@nestjs/common';
import { SignJWT, importPKCS8, importSPKI, jwtVerify, type KeyLike } from 'jose';
import { env, pem } from '../config/env';

export interface AccessClaims {
  sub: string;
  email: string;
  role: 'USER' | 'SUPER_ADMIN';
}

const ACCESS_TTL_SECONDS = 10 * 60;

@Injectable()
export class CryptoService {
  private readonly accessKey = new TextEncoder().encode(env().FV_JWT_SECRET);
  private privateKey?: Promise<KeyLike>;
  private publicKey?: Promise<KeyLike>;

  readonly accessTtlSeconds = ACCESS_TTL_SECONDS;

  async signAccess(c: AccessClaims): Promise<string> {
    return new SignJWT({ email: c.email, role: c.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.sub)
      .setIssuer('folioverse-api')
      .setAudience('folioverse-web')
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.accessKey);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.accessKey, { issuer: 'folioverse-api', audience: 'folioverse-web' });
    return { sub: payload.sub as string, email: payload.email as string, role: payload.role as AccessClaims['role'] };
  }

  private priv() {
    this.privateKey ??= importPKCS8(pem(env().FV_INTERNAL_JWT_PRIVATE_KEY), 'ES256');
    return this.privateKey;
  }

  private pub() {
    this.publicKey ??= importSPKI(pem(env().FV_INTERNAL_JWT_PUBLIC_KEY), 'ES256');
    return this.publicKey;
  }

  /** Service-to-service bearer token for api-worker -> AI service calls. */
  async signInternal(subject = 'api-worker', ttlSeconds = 300): Promise<string> {
    return new SignJWT({ typ: 'internal' })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(subject)
      .setIssuer('folioverse-api')
      .setAudience('folioverse-ai')
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(await this.priv());
  }

  /** Scope token: the only source of vector-store filters inside the AI service. */
  async signScope(runId: string, workspaceId: string, sourceVersionIds: string[], ttlSeconds = 600): Promise<string> {
    return new SignJWT({ typ: 'scope', wid: workspaceId, svids: sourceVersionIds })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(runId)
      .setIssuer('folioverse-api')
      .setAudience('folioverse-ai')
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(await this.priv());
  }

  async verifyInternal(token: string) {
    const { payload } = await jwtVerify(token, await this.pub(), { issuer: 'folioverse-api', audience: 'folioverse-ai' });
    return payload;
  }
}

@Global()
@Module({ providers: [CryptoService], exports: [CryptoService] })
export class CryptoModule {}
