import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser, AuthUser, Public } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from './auth.service';
import { AcceptInviteDto, ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshDto, RegisterCompanyDto, ResetPasswordDto, TokenDto } from './dto';

const ctx = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
// per-IP limit on credential endpoints (configurable; tests raise it)
const strict = { default: { limit: () => Number(process.env.AUTH_RATE_LIMIT ?? 10), ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Public() @Throttle(strict) @Post('register-company')
  register(@Body() dto: RegisterCompanyDto, @Req() req: Request) { return this.auth.registerCompany(dto, ctx(req)); }

  @Public() @Throttle(strict) @HttpCode(200) @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) { return this.auth.login(dto, ctx(req)); }

  @Public() @Throttle(strict) @HttpCode(200) @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) { return this.auth.refresh(dto.refreshToken, ctx(req)); }

  @Public() @HttpCode(200) @Post('logout')
  logout(@Body() dto: RefreshDto) { return this.auth.logout(dto.refreshToken); }

  @Public() @Throttle(strict) @HttpCode(200) @Post('verify-email')
  verify(@Body() dto: TokenDto) { return this.auth.verifyEmail(dto.token); }

  @Public() @Throttle(strict) @HttpCode(200) @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) { return this.auth.forgotPassword(dto.companyCode, dto.email); }

  @Public() @Throttle(strict) @HttpCode(200) @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto.token, dto.newPassword); }

  @Public() @Throttle(strict) @HttpCode(200) @Post('accept-invite')
  accept(@Body() dto: AcceptInviteDto) { return this.auth.acceptInvite(dto); }

  @HttpCode(200) @Post('change-password')
  change(@CurrentUser() u: AuthUser, @Body() dto: ChangePasswordDto) { return this.auth.changePassword(u.companyId, u.userId, dto); }

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: u.userId },
        select: { id: true, name: true, email: true, emailVerifiedAt: true, roles: { select: { role: { select: { id: true, name: true } } } } },
      });
      const perms = await tx.rolePermission.findMany({
        where: { role: { users: { some: { userId: u.userId } } } },
        select: { permission: { select: { resource: true, action: true } } },
      });
      const company = await tx.company.findUniqueOrThrow({ where: { id: u.companyId }, select: { id: true, code: true, name: true, baseCurrency: true, trn: true } });
      return {
        ...user,
        roles: user.roles.map((r) => r.role),
        permissions: [...new Set(perms.map((p) => `${p.permission.resource}:${p.permission.action}`))].sort(),
        company,
      };
    });
  }
}
