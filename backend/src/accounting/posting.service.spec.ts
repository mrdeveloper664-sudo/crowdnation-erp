import { PostingService } from './posting.service';
import { D } from '../common/money';

/** Pure unit tests of the posting engine's validation & arithmetic against a faked transaction. */
function fakeTx(opts: { base?: string; dp?: number; accounts?: string[]; inactive?: string[] } = {}) {
  const created: any[] = [];
  const ids = opts.accounts ?? ['a1', 'a2', 'a3', 'rounding'];
  const tx: any = {
    company: { findUniqueOrThrow: async () => ({ id: 'c', baseCurrency: opts.base ?? 'AED', settings: { amountDecimals: opts.dp ?? 2 } }) },
    journalEntry: { findUnique: async () => null, create: async (a: any) => { created.push(a.data); return { id: 'je', entryNumber: 'JE-1', lines: [] }; } },
    account: {
      findMany: async (q: any) => ids.filter((id) => q.where.id.in.includes(id)).map((id) => ({ id, code: id, name: id, isActive: !(opts.inactive ?? []).includes(id) })),
      findFirst: async () => ({ id: 'rounding' }),
    },
  };
  return { tx, created };
}
const periods: any = { requireOpenPeriod: async () => ({ id: 'p', financialYearId: 'fy', financialYear: { startDate: new Date('2026-01-01') } }) };
const seq: any = { next: async () => 1, pad: (n: number) => String(n) };
const base = { companyId: 'c', userId: 'u', entryDate: new Date('2026-03-01'), sourceType: 'SYSTEM' as const, idempotencyKey: 'k' };
const svc = () => new PostingService(periods, seq);

describe('PostingService', () => {
  it('posts a balanced entry', async () => {
    const { tx, created } = fakeTx();
    await svc().post(tx, { ...base, lines: [{ accountId: 'a1', debit: '100.10' }, { accountId: 'a2', credit: '100.10' }] });
    expect(created[0].lines.create).toHaveLength(2);
  });
  it('0.1 + 0.2 style sums are exact (no floating point)', async () => {
    const { tx } = fakeTx();
    await expect(svc().post(tx, { ...base, lines: [{ accountId: 'a1', debit: '0.10' }, { accountId: 'a2', debit: '0.20' }, { accountId: 'a3', credit: '0.30' }] })).resolves.toBeDefined();
  });
  it('rejects unbalanced entries', async () => {
    const { tx } = fakeTx();
    await expect(svc().post(tx, { ...base, lines: [{ accountId: 'a1', debit: '10.00' }, { accountId: 'a2', credit: '9.99' }] })).rejects.toThrow(/not balanced/);
  });
  it('rejects single-line, negative, both-sided and empty lines', async () => {
    const { tx } = fakeTx();
    await expect(svc().post(tx, { ...base, lines: [{ accountId: 'a1', debit: '10' }] })).rejects.toThrow(/at least two/);
    await expect(svc().post(tx, { ...base, lines: [{ accountId: 'a1', debit: '-1' }, { accountId: 'a2', credit: '-1' }] })).rejects.toThrow(/negative/);
    await expect(svc().post(tx, { ...base, lines: [{ accountId: 'a1', debit: '1', credit: '1' }, { accountId: 'a2', credit: '1' }] })).rejects.toThrow(/both/);
    await expect(svc().post(tx, { ...base, lines: [{ accountId: 'a1' }, { accountId: 'a2', credit: '1' }] })).rejects.toThrow(/required/);
  });
  it('rejects too many decimals and inactive/unknown accounts', async () => {
    await expect(svc().post(fakeTx().tx, { ...base, lines: [{ accountId: 'a1', debit: '1.005' }, { accountId: 'a2', credit: '1.005' }] })).rejects.toThrow(/decimal/);
    await expect(svc().post(fakeTx({ inactive: ['a2'] }).tx, { ...base, lines: [{ accountId: 'a1', debit: '1' }, { accountId: 'a2', credit: '1' }] })).rejects.toThrow(/inactive/);
    await expect(svc().post(fakeTx({ accounts: ['a1'] }).tx, { ...base, lines: [{ accountId: 'a1', debit: '1' }, { accountId: 'zz', credit: '1' }] })).rejects.toThrow(/do not exist/);
  });
  it('rejects duplicates', async () => {
    const { tx } = fakeTx();
    tx.journalEntry.findUnique = async () => ({ id: 'x', entryNumber: 'JE-9' });
    await expect(svc().post(tx, { ...base, lines: [{ accountId: 'a1', debit: '1' }, { accountId: 'a2', credit: '1' }] })).rejects.toThrow(/Already posted/);
  });
  it('translates foreign currency and absorbs rounding cents into the rounding account', async () => {
    const { tx, created } = fakeTx();
    // 3 x 0.03 USD debit vs 0.09 credit @ 3.6725: 0.1102 each -> 0.11 x3 = 0.33 vs 0.3305 -> 0.33 ... construct a case that rounds apart
    await svc().post(tx, { ...base, currency: 'USD', exchangeRate: '3.6725',
      lines: [{ accountId: 'a1', debit: '0.01' }, { accountId: 'a2', debit: '0.01' }, { accountId: 'a3', credit: '0.02' }] });
    const lines = created[0].lines.create;
    const dr = lines.reduce((s: any, l: any) => s.add(l.debit), D(0));
    const cr = lines.reduce((s: any, l: any) => s.add(l.credit), D(0));
    expect(dr.eq(cr)).toBe(true);
    expect(lines.some((l: any) => l.accountId === 'rounding')).toBe(true); // 0.04+0.04 vs 0.07
  });
  it('requires an exchange rate for foreign currency', async () => {
    await expect(svc().post(fakeTx().tx, { ...base, currency: 'USD', lines: [{ accountId: 'a1', debit: '1' }, { accountId: 'a2', credit: '1' }] })).rejects.toThrow(/exchange rate/);
  });
});
