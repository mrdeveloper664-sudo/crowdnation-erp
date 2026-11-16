/* Development seed: demo company "DEMO" with sample vouchers. Idempotent. Run: npm run db:seed */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/common/prisma.service';
import { VouchersService } from '../src/vouchers/vouchers.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  if (await prisma.company.findUnique({ where: { code: 'DEMO' } })) {
    console.log('DEMO company already exists - nothing to do');
    return app.close();
  }
  const reg = await app.get(AuthService).registerCompany(
    { companyName: 'Demo Trading LLC', companyCode: 'DEMO', adminName: 'Demo Admin', adminEmail: 'admin@demo.test', password: 'Demo@12345678', trn: '100000000000003' }, {},
  );
  const vouchers = app.get(VouchersService);
  const today = new Date().toISOString().slice(0, 10);
  const acc = await prisma.tenant(reg.companyId, async (tx) => Object.fromEntries((await tx.account.findMany()).map((a) => [a.code, a.id])));
  const post = async (type: any, lines: any[], narration: string) => {
    const v = await vouchers.create(reg.companyId, reg.userId, { type, date: today, narration, lines });
    await vouchers.post(reg.companyId, reg.userId, v.id);
  };
  await post('RECEIPT', [{ accountId: acc['1112'], debit: '50000.00' }, { accountId: acc['3001'], credit: '50000.00' }], 'Owner capital introduced');
  await post('PAYMENT', [{ accountId: acc['5202'], debit: '4500.00' }, { accountId: acc['1112'], credit: '4500.00' }], 'Office rent');
  await post('CONTRA', [{ accountId: acc['1111'], debit: '2000.00' }, { accountId: acc['1112'], credit: '2000.00' }], 'Cash withdrawn from bank');
  console.log('Seeded. Login -> companyCode: DEMO, email: admin@demo.test, password: Demo@12345678');
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
