import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuditService } from '../common/audit.service';
import { MailService } from '../common/mail.service';
import { PrismaService, Tx } from '../common/prisma.service';
import { CompanyBootstrapService } from '../companies/company-bootstrap.service';
import { AcceptInviteDto, ChangePasswordDto, LoginDto, RegisterCompanyDto } from './dto';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

export interface ClientCtx { ip?: string; userAgent?: string }

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private cfg: ConfigService,
    private bootstrap: CompanyBootstrapService,
    private audit: AuditService,
    private mail: MailService,
  ) {}

  // ------------------------------------------------------------ registration
  async registerCompany(dto: RegisterCompanyDto, ctx: ClientCtx) {
    const code = dto.companyCode.toUpperCase();
    if (await this.prisma.company.findUnique({ where: { code } })) throw new ConflictException('Company code is already taken');
    if (dto.trn && (await this.prisma.company.findUnique({ where: { trn: dto.trn } }))) throw new ConflictException('TRN is already registered');

    const companyId = randomUUID();
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    let verifyToken = '';
    const result = await this.prisma.tenant(companyId, async (tx) => {
      await tx.company.create({
        data: {
          id: companyId, code, name: dto.companyName, baseCurrency: (dto.baseCurrency ?? 'AED').toUpperCase(),
          country: (dto.country ?? 'AE').toUpperCase(), trn: dto.trn, email: dto.adminEmail.toLowerCase(),
        },
      });
      const { roles } = await this.bootstrap.bootstrap(tx, companyId, 1);
      const user = await tx.user.create({
        data: { companyId, email: dto.adminEmail.toLowerCase(), name: dto.adminName, passwordHash },
      });
      await tx.userRole.create({ data: { companyId, userId: user.id, roleId: roles['Company Administrator'] } });
      verifyToken = await this.issueEmailToken(tx, companyId, user.id, 'EMAIL_VERIFY', 60 * 24 * 3);
      await this.audit.log(tx, { companyId, userId: user.id, action: 'company.registered', entityType: 'company', entityId: companyId, ip: ctx.ip });
      return { companyId, userId: user.id };
    });
    await this.mail.send({
      to: dto.adminEmail, subject: 'Verify your NEXERP email', kind: 'verify', token: verifyToken,
      text: `Verify your email with token: ${verifyToken}`,
    });
    return { companyId: result.companyId, companyCode: code, userId: result.userId, emailVerificationSent: true };
  }

  // ------------------------------------------------------------ login & tokens
  async login(dto: LoginDto, ctx: ClientCtx) {
    const invalid = new UnauthorizedException('Invalid company code, email or password');
    const company = await this.prisma.company.findUnique({ where: { code: dto.companyCode.toUpperCase() } });
    if (!company) { await argon2.hash(dto.password).catch(() => 0); throw invalid; } // keep timing similar
    if (company.status !== 'ACTIVE') throw new ForbiddenException('Company is suspended');

    return this.prisma.tenant(company.id, async (tx) => {
      const user = await tx.user.findUnique({ where: { companyId_email: { companyId: company.id, email: dto.email.toLowerCase() } } });
      if (!user || !user.isActive) { await argon2.hash(dto.password).catch(() => 0); throw invalid; }
      if (user.lockedUntil && user.lockedUntil > new Date()) throw new ForbiddenException('Account temporarily locked due to repeated failed logins');

      const ok = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
      if (!ok) {
        const failed = user.failedLogins + 1;
        await tx.user.update({
          where: { id: user.id },
          data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
        });
        await tx.auditLog.create({ data: { companyId: company.id, userId: user.id, action: 'auth.login_failed', entityType: 'user', entityId: user.id, ip: ctx.ip } });
        // commit the failure counter even though we throw -> return marker instead of throwing inside tx
        return { __failed: true } as any;
      }
      if (this.cfg.get('REQUIRE_EMAIL_VERIFICATION') === 'true' && !user.emailVerifiedAt) throw new ForbiddenException('Email not verified');

      await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
      const tokens = await this.issueTokens(tx, company.id, user.id, randomUUID(), ctx);
      return { ...tokens, user: { id: user.id, name: user.name, email: user.email, companyId: company.id, companyCode: company.code } };
    }).then((r) => { if ((r as any)?.__failed) throw invalid; return r; });
  }

  private async issueTokens(tx: Tx, companyId: string, userId: string, familyId: string, ctx: ClientCtx) {
    const accessToken = await this.jwt.signAsync({ sub: userId, cid: companyId, typ: 'access' });
    const raw = secret();
    const ttlDays = Number(this.cfg.get('REFRESH_TTL_DAYS') ?? 30);
    const row = await tx.refreshToken.create({
      data: {
        companyId, userId, familyId, tokenHash: sha(raw), userAgent: ctx.userAgent?.slice(0, 250), ip: ctx.ip,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      },
    });
    return { accessToken, refreshToken: `${companyId}.${raw}`, refreshTokenId: row.id, expiresIn: this.cfg.get('JWT_ACCESS_TTL') ?? '15m' };
  }

  private parseOpaque(token: string): { companyId: string; raw: string } {
    const i = token.indexOf('.');
    const companyId = token.slice(0, i);
    if (i < 0 || !/^[0-9a-f-]{36}$/i.test(companyId)) throw new UnauthorizedException('Invalid token');
    return { companyId, raw: token.slice(i + 1) };
  }

  /** Refresh-token rotation with reuse detection (a replayed token revokes the whole family). */
  async refresh(token: string, ctx: ClientCtx) {
    const { companyId, raw } = this.parseOpaque(token);
    const outcome = await this.prisma.tenant(companyId, async (tx) => {
      const row = await tx.refreshToken.findUnique({ where: { tokenHash: sha(raw) } });
      if (!row) return { error: 'Invalid refresh token' } as const;
      if (row.revokedAt) {
        await tx.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        return { error: 'Refresh token reuse detected - session revoked' } as const;
      }
      if (row.expiresAt < new Date()) return { error: 'Refresh token expired' } as const;
      const user = await tx.user.findUnique({ where: { id: row.userId } });
      if (!user?.isActive) return { error: 'User disabled' } as const;
      const next = await this.issueTokens(tx, companyId, row.userId, row.familyId, ctx);
      await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedBy: next.refreshTokenId } });
      return { tokens: next } as const;
    });
    if ('error' in outcome) throw new UnauthorizedException(outcome.error);
    const { refreshTokenId, ...tokens } = outcome.tokens;
    return tokens;
  }

  async logout(token: string) {
    const { companyId, raw } = this.parseOpaque(token);
    await this.prisma.tenant(companyId, async (tx) => {
      const row = await tx.refreshToken.findUnique({ where: { tokenHash: sha(raw) } });
      if (row) await tx.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return { loggedOut: true };
  }

  // ------------------------------------------------------------ email tokens
  private async issueEmailToken(tx: Tx, companyId: string, userId: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET', minutes: number) {
    const raw = secret();
    await tx.emailToken.create({ data: { companyId, userId, type, tokenHash: sha(raw), expiresAt: new Date(Date.now() + minutes * 60_000) } });
    return `${companyId}.${raw}`;
  }

  private async consumeEmailToken(tx: Tx, token: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
    const { raw } = this.parseOpaque(token);
    const row = await tx.emailToken.findUnique({ where: { tokenHash: sha(raw) } });
    if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) throw new BadRequestException('Token is invalid or expired');
    await tx.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return row;
  }

  async verifyEmail(token: string) {
    const { companyId } = this.parseOpaque(token);
    return this.prisma.tenant(companyId, async (tx) => {
      const row = await this.consumeEmailToken(tx, token, 'EMAIL_VERIFY');
      await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
      return { verified: true };
    });
  }

  /** Always answers the same way - never reveals whether an account exists. */
  async forgotPassword(companyCode: string, email: string) {
    const company = await this.prisma.company.findUnique({ where: { code: companyCode.toUpperCase() } });
    if (company) {
      const token = await this.prisma.tenant(company.id, async (tx) => {
        const user = await tx.user.findUnique({ where: { companyId_email: { companyId: company.id, email: email.toLowerCase() } } });
        if (!user?.isActive) return null;
        return this.issueEmailToken(tx, company.id, user.id, 'PASSWORD_RESET', 60);
      });
      if (token) await this.mail.send({ to: email, subject: 'Reset your NEXERP password', kind: 'reset', token, text: `Reset token: ${token}` });
    }
    return { message: 'If the account exists, a reset email has been sent' };
  }

  async resetPassword(token: string, newPassword: string) {
    const { companyId } = this.parseOpaque(token);
    const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
    return this.prisma.tenant(companyId, async (tx) => {
      const row = await this.consumeEmailToken(tx, token, 'PASSWORD_RESET');
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash: hash, failedLogins: 0, lockedUntil: null } });
      await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, { companyId, userId: row.userId, action: 'auth.password_reset', entityType: 'user', entityId: row.userId });
      return { reset: true };
    });
  }

  async changePassword(companyId: string, userId: string, dto: ChangePasswordDto) {
    const hash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    return this.prisma.tenant(companyId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) throw new UnauthorizedException('Current password is incorrect');
      await tx.user.update({ where: { id: userId }, data: { passwordHash: hash } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, { companyId, userId, action: 'auth.password_changed', entityType: 'user', entityId: userId });
      return { changed: true };
    });
  }

  // ------------------------------------------------------------ invitations
  async acceptInvite(dto: AcceptInviteDto) {
    const { companyId, raw } = this.parseOpaque(dto.token);
    const hash = await argon2.hash(dto.password, { type: argon2.argon2id });
    return this.prisma.tenant(companyId, async (tx) => {
      const inv = await tx.invitation.findUnique({ where: { tokenHash: sha(raw) } });
      if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw new BadRequestException('Invitation is invalid or expired');
      const exists = await tx.user.findUnique({ where: { companyId_email: { companyId, email: inv.email } } });
      if (exists) throw new ConflictException('User already exists');
      const user = await tx.user.create({
        data: { companyId, email: inv.email, name: dto.name, passwordHash: hash, emailVerifiedAt: new Date() },
      });
      await tx.userRole.create({ data: { companyId, userId: user.id, roleId: inv.roleId } });
      await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      await this.audit.log(tx, { companyId, userId: user.id, action: 'user.invitation_accepted', entityType: 'user', entityId: user.id });
      return { userId: user.id };
    });
  }

  inviteToken() { return secret(); }
  hash(s: string) { return sha(s); }
}
