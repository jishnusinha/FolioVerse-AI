import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Decimal } from 'decimal.js';
import { env } from '../../config/env';
import { AuditService } from '../../common/audit.service';
import { CryptoService } from '../../common/crypto.service';
import { newId, randomToken, sha256Hex } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { MailService } from '../mail/mail.service';

const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export interface IssuedSession {
  access: string;
  refresh: string;
  csrf: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  publicUser(u: { id: string; email: string; displayName: string; platformRole: string; emailVerifiedAt: Date | null; preferences: any }) {
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      platformRole: u.platformRole,
      emailVerified: !!u.emailVerifiedAt,
      preferences: u.preferences ?? {},
    };
  }

  async register(email: string, password: string, displayName: string, ip?: string | null) {
    if (!env().FV_ALLOW_REGISTRATION) throw new ForbiddenException('Registration is disabled');
    const normalized = email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (exists) throw new ConflictException({ message: 'An account with this email already exists', code: 'EMAIL_TAKEN' });

    const userId = newId();
    const workspaceId = newId();
    const isAdmin = !!env().FV_SEED_ADMIN_EMAIL && env().FV_SEED_ADMIN_EMAIL!.toLowerCase() === normalized;
    const passwordHash = await argon2.hash(password, ARGON);
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const limit = new Decimal(env().FV_DEFAULT_MONTHLY_BUDGET).toFixed(8);
    const policyId = newId();

    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { id: userId, email: normalized, passwordHash, displayName, platformRole: isAdmin ? 'SUPER_ADMIN' : 'USER' },
      });
      await tx.workspace.create({ data: { id: workspaceId, name: `${displayName}'s workspace`, kind: 'PERSONAL', ownerId: userId } });
      await tx.workspaceMember.create({ data: { workspaceId, userId, role: 'OWNER' } });
      await tx.project.createMany({
        data: [
          { id: newId(), workspaceId, name: 'My Knowledge', kind: 'KNOWLEDGE', createdById: userId },
          { id: newId(), workspaceId, name: 'My Writing', kind: 'WRITER', createdById: userId },
          { id: newId(), workspaceId, name: 'My Library', kind: 'LIBRARY', createdById: userId },
        ],
      });
      await tx.budgetPolicy.create({
        data: { id: policyId, workspaceId, scope: 'WORKSPACE', period: 'MONTHLY', limitAmount: limit, hard: true },
      });
      await tx.budgetPeriod.create({
        data: { id: newId(), workspaceId, policyId, periodStart, periodEnd, limitAmount: limit },
      });
      return user;
    });

    await this.sendVerification(user.id, user.email);
    await this.audit.record({ workspaceId, actorId: user.id, action: 'auth.register', resourceType: 'user', resourceId: user.id, ip });
    return user;
  }

  async login(email: string, password: string, ip?: string | null) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Constant-ish work for unknown emails to blunt account enumeration via timing.
    const ok = user && !user.deletedAt ? await argon2.verify(user.passwordHash, password) : await argon2.hash(password, ARGON).then(() => false);
    if (!user || !ok) {
      await this.audit.record({ action: 'auth.login_failed', resourceType: 'user', metadata: { reason: 'invalid_credentials' }, ip });
      throw new UnauthorizedException({ message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }
    await this.audit.record({ actorId: user.id, action: 'auth.login', resourceType: 'user', resourceId: user.id, ip });
    return user;
  }

  async issueSession(user: { id: string; email: string; platformRole: string }, familyId = newId(), userAgent?: string): Promise<IssuedSession> {
    const refresh = randomToken(32);
    await this.prisma.refreshToken.create({
      data: {
        id: newId(),
        userId: user.id,
        familyId,
        tokenHash: sha256Hex(refresh),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        userAgent: userAgent?.slice(0, 200),
      },
    });
    const access = await this.crypto.signAccess({ sub: user.id, email: user.email, role: user.platformRole as any });
    return {
      access,
      refresh,
      csrf: randomToken(18),
      accessMaxAgeMs: this.crypto.accessTtlSeconds * 1000,
      refreshMaxAgeMs: REFRESH_TTL_MS,
    };
  }

  /** Rotates a refresh token. Presenting an already-rotated token revokes the whole family. */
  async refresh(token: string | undefined, userAgent?: string): Promise<{ session: IssuedSession; user: any }> {
    if (!token) throw new UnauthorizedException({ message: 'No refresh token', code: 'NO_REFRESH' });
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
    if (!row) throw new UnauthorizedException({ message: 'Invalid refresh token', code: 'INVALID_REFRESH' });
    if (row.revokedAt || row.replacedById) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorId: row.userId, action: 'auth.refresh_reuse_detected', resourceType: 'refresh_family', resourceId: row.familyId });
      throw new UnauthorizedException({ message: 'Refresh token reuse detected; please sign in again', code: 'REFRESH_REUSE' });
    }
    if (row.expiresAt < new Date() || row.user.deletedAt) throw new UnauthorizedException({ message: 'Refresh token expired', code: 'REFRESH_EXPIRED' });

    const session = await this.issueSession(row.user, row.familyId, userAgent);
    const next = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(session.refresh) } });
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, replacedById: null, revokedAt: null },
      data: { replacedById: next!.id, revokedAt: new Date() },
    });
    if (claimed.count !== 1) {
      // Lost a race with a concurrent rotation of the same token: treat as reuse.
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException({ message: 'Refresh token reuse detected; please sign in again', code: 'REFRESH_REUSE' });
    }
    return { session, user: row.user };
  }

  async logout(token: string | undefined) {
    if (!token) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (row) await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async createAuthToken(userId: string, kind: 'EMAIL_VERIFY' | 'PASSWORD_RESET', ttlMs: number) {
    const token = randomToken(24);
    await this.prisma.authToken.create({
      data: { id: newId(), userId, kind, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  async sendVerification(userId: string, email: string) {
    const token = await this.createAuthToken(userId, 'EMAIL_VERIFY', 48 * 3600 * 1000);
    await this.mail.send({
      to: email,
      subject: 'Verify your FolioVerse email',
      text: `Confirm your email: ${env().APP_ORIGIN}/verify-email?token=${token}`,
    });
  }

  private async consume(token: string, kind: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
    const row = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) throw new BadRequestException({ message: 'Token is invalid or expired', code: 'BAD_TOKEN' });
    const used = await this.prisma.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new BadRequestException({ message: 'Token already used', code: 'BAD_TOKEN' });
    return row;
  }

  async verifyEmail(token: string) {
    const row = await this.consume(token, 'EMAIL_VERIFY');
    await this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) return; // same response either way
    const token = await this.createAuthToken(user.id, 'PASSWORD_RESET', 3600 * 1000);
    await this.mail.send({
      to: user.email,
      subject: 'Reset your FolioVerse password',
      text: `Reset your password: ${env().APP_ORIGIN}/reset-password?token=${token} (valid for 1 hour)`,
    });
  }

  async resetPassword(token: string, password: string) {
    const row = await this.consume(token, 'PASSWORD_RESET');
    await this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await argon2.hash(password, ARGON) } });
    await this.prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ actorId: row.userId, action: 'auth.password_reset', resourceType: 'user', resourceId: row.userId });
  }
}
