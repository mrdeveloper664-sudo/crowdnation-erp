import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC, PERMISSION_KEY } from '../decorators';
import { PrismaService } from '../prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    try {
      const payload = await this.jwt.verifyAsync(header.slice(7), { algorithms: ['HS256'] });
      if (payload.typ !== 'access') throw new Error('wrong token type');
      req.user = { userId: payload.sub, companyId: payload.cid };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<{ resource: string; action: string }>(PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true;
    const { user } = ctx.switchToHttp().getRequest();
    if (!user) throw new UnauthorizedException();
    const ok = await this.prisma.tenant(user.companyId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id: user.userId }, select: { isActive: true } });
      if (!u?.isActive) return false;
      const n = await tx.rolePermission.count({
        where: {
          role: { users: { some: { userId: user.userId } } },
          permission: { resource: required.resource, action: required.action },
        },
      });
      return n > 0;
    });
    if (!ok) throw new ForbiddenException(`Missing permission ${required.resource}:${required.action}`);
    return true;
  }
}
