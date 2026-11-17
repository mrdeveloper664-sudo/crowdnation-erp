/* Creates the "Crowd Nation" company (idempotent). No password is stored in the repository:
 *   CROWD_ADMIN_PASSWORD=...  npm run db:seed:crowdnation
 * If CROWD_ADMIN_PASSWORD is not set, a random one is generated and printed once.
 * Optional overrides: CROWD_COMPANY_NAME, CROWD_COMPANY_CODE, CROWD_CURRENCY, CROWD_TRN, CROWD_ADMIN_NAME, CROWD_ADMIN_EMAIL */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/common/prisma.service';

async function main() {
  const env = process.env;
  const code = (env.CROWD_COMPANY_CODE ?? 'CROWD').toUpperCase();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    if (await app.get(PrismaService).company.findUnique({ where: { code } })) { console.log(`Company ${code} already exists - nothing to do`); return; }
    const generated = !env.CROWD_ADMIN_PASSWORD;
    // meets the password policy (upper, lower, digit, symbol, length)
    const password = env.CROWD_ADMIN_PASSWORD ?? `Cn-${randomBytes(9).toString('base64url')}-9a`;
    const email = env.CROWD_ADMIN_EMAIL ?? 'admin@crowdnation.test';
    await app.get(AuthService).registerCompany({
      companyName: env.CROWD_COMPANY_NAME ?? 'Crowd Nation', companyCode: code, baseCurrency: env.CROWD_CURRENCY ?? 'AED', country: 'AE',
      trn: env.CROWD_TRN || undefined, adminName: env.CROWD_ADMIN_NAME ?? 'Crowd Nation Admin', adminEmail: email, password,
    }, {});
    console.log(`Created company "${env.CROWD_COMPANY_NAME ?? 'Crowd Nation'}"\n  company code: ${code}\n  email:        ${email}`);
    console.log(generated ? `  password:     ${password}   (generated - shown only now, change it after login)` : '  password:     (from CROWD_ADMIN_PASSWORD)');
  } finally { await app.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
