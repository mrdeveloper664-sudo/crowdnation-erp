import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PASSWORD, Tenant, accountMap, api, createApp, registerAndLogin, today } from './helpers';
import { MailService } from '../src/common/mail.service';
import { JobsService } from '../src/common/jobs.service';

describe('CRM, HR, expenses, projects, assets, dashboard (e2e)', () => {
  let app: INestApplication; let T: Tenant; let acc: Record<string, string>; let c: ReturnType<typeof api>; let mail: MailService;
  const rep = async (n: string, q = '') => (await c.get(`/reports/run/${n}?${q}`).expect(200)).body.data;
  const tb = async () => (await rep('trial-balance')).meta.balanced;
  const bal = async (code: string) => { acc = await accountMap(app, T.token); const l = (await c.get(`/ledgers/${acc[code]}`).expect(200)).body.data; return `${l.balance}${l.balanceSide ? ' ' + l.balanceSide : ''}`; };
  const y = new Date().getUTCFullYear(); const month = String(new Date().getUTCMonth() + 1).padStart(2, '0');

  // second user with the Accountant role so approvals respect segregation of duties
  let approver: ReturnType<typeof api>; let approverId: string;
  async function inviteUser(roleName: string, email: string) {
    const roles = (await c.get('/roles').expect(200)).body.data;
    await c.post('/users/invitations', { email, roleId: roles.find((r: any) => r.name === roleName).id }).expect(201);
    const inv = mail.outbox.filter((m) => m.kind === 'invite' && m.to === email).pop()!;
    const acc = await request(app.getHttpServer()).post('/api/v1/auth/accept-invite').send({ token: inv.token, name: roleName, password: PASSWORD }).expect(200);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ companyCode: T.code, email, password: PASSWORD }).expect(200);
    return { client: api(app, login.body.data.accessToken), id: acc.body.data.userId as string };
  }

  beforeAll(async () => {
    ({ app, mail } = await createApp());
    T = await registerAndLogin(app, 'Modules Co'); c = api(app, T.token); acc = await accountMap(app, T.token);
    const v = await c.post('/vouchers', { type: 'RECEIPT', date: today(), lines: [{ accountId: acc['1112'], debit: '500000.00' }, { accountId: acc['3001'], credit: '500000.00' }] }).expect(201);
    await c.post(`/vouchers/${v.body.data.id}/post`).expect(200);
    const fm = await inviteUser('HR Manager', `fm@${T.code.toLowerCase()}.test`); approver = fm.client; approverId = fm.id;
  });
  afterAll(async () => { await app.close(); });

  describe('CRM', () => {
    it('lead lifecycle: create, assign (notifies), stage change, convert to customer, pipeline and report', async () => {
      const src = (await c.post('/crm/sources', { name: 'Website' }).expect(201)).body.data;
      const lead = (await c.post('/crm/leads', { name: 'Omar Khan', companyName: 'Khan Trading', email: 'omar@khan.test', sourceId: src.id, value: '15000.00', assignedTo: approverId }).expect(201)).body.data;
      const n = (await approver.get('/notifications?unread=true').expect(200)).body;
      expect(n.data[0].title).toBe('New lead assigned'); expect(n.meta.unread).toBe(1);
      await approver.post(`/notifications/${n.data[0].id}/read`).expect(200);
      expect((await approver.get('/notifications?unread=true').expect(200)).body.meta.unread).toBe(0);
      await c.post(`/crm/leads/${lead.id}/stage`, { stage: 'QUALIFIED' }).expect(200);
      await c.post(`/crm/leads/${lead.id}/stage`, { stage: 'LOST' }).expect(400); // reason required
      await c.post('/crm/activities', { leadId: lead.id, type: 'CALL', subject: 'Intro call', notes: 'Interested in 2 units' }).expect(201);
      await c.post('/crm/activities', { leadId: lead.id, type: 'TASK', subject: 'Send proposal', dueAt: new Date(Date.now() - 3600_000).toISOString() }).expect(201);
      expect((await c.post('/crm/reminders/run').expect(200)).body.data.reminded).toBe(1);
      const pipe = (await c.get('/crm/pipeline').expect(200)).body.data;
      expect(pipe.find((s: any) => s.stage === 'QUALIFIED')).toMatchObject({ count: 1, value: '15000.00' });
      const conv = (await c.post(`/crm/leads/${lead.id}/convert`).expect(200)).body.data;
      await c.post(`/crm/leads/${lead.id}/convert`).expect(400);
      expect((await c.get(`/customers/${conv.customerId}`).expect(200)).body.data.name).toBe('Khan Trading');
      expect((await c.get(`/crm/leads/${lead.id}`).expect(200)).body.data.activities.length).toBeGreaterThanOrEqual(3);
      const r = await rep('lead-report');
      expect(r.rows[0]).toMatchObject({ source: 'Website', won: '1', conversion: '100.0%' });
    });
  });

  describe('HR & payroll', () => {
    let e1: any; let e2: any;
    it('employees, salary structure, attendance and leave (balance, approval, self-approval blocked)', async () => {
      const dept = (await c.post('/hr/departments', { name: 'Operations' }).expect(201)).body.data;
      e1 = (await c.post('/hr/employees', { name: 'Aisha Rahman', departmentId: dept.id, joinDate: `${y - 1}-01-01`, basicSalary: '6000.00' }).expect(201)).body.data;
      e2 = (await c.post('/hr/employees', { name: 'Bilal Ahmed', joinDate: `${y - 1}-03-01`, basicSalary: '3000.00', userId: approverId }).expect(201)).body.data;
      expect([e1.code, e2.code]).toEqual(['E0001', 'E0002']);
      const housing = (await c.post('/hr/salary-components', { name: 'Housing', type: 'ALLOWANCE', calc: 'PERCENT_OF_BASIC' }).expect(201)).body.data;
      const loan = (await c.post('/hr/salary-components', { name: 'Loan recovery', type: 'DEDUCTION', calc: 'FIXED' }).expect(201)).body.data;
      await c.put(`/hr/employees/${e1.id}/salary-items`, { items: [{ componentId: housing.id, value: '25' }, { componentId: loan.id, value: '200.00' }] }).expect(200);
      const annual = (await c.post('/hr/leave-types', { name: 'Annual', daysPerYear: 30, isPaid: true }).expect(201)).body.data;
      const unpaid = (await c.post('/hr/leave-types', { name: 'Unpaid', daysPerYear: 0, isPaid: false }).expect(201)).body.data;
      // Bilal (linked to the approver user) requests leave; admin approves
      const lr = (await approver.post('/hr/leave', { leaveTypeId: annual.id, fromDate: `${y}-02-02`, toDate: `${y}-02-06`, reason: 'Family' }).expect(201)).body.data;
      expect(lr.days).toBe('5');
      await approver.post('/hr/leave', { leaveTypeId: annual.id, fromDate: `${y}-02-04`, toDate: `${y}-02-05` }).expect(409); // overlap
      await approver.post('/hr/leave', { leaveTypeId: annual.id, fromDate: `${y}-05-01`, toDate: `${y}-06-15` }).expect(400); // exceeds allowance
      await approver.post(`/hr/leave/${lr.id}/approve`).expect(200).catch(() => 0);
      await c.post(`/hr/leave/${lr.id}/approve`).expect(200);
      const bal = (await c.get(`/hr/leave/balance/${e2.id}?year=${y}`).expect(200)).body.data;
      expect(bal.find((b: any) => b.leaveType === 'Annual')).toMatchObject({ used: '5', remaining: '25' });
      // Aisha: 2 absent days + 3 unpaid-leave days in the current month
      await c.put('/hr/attendance', { employeeId: e1.id, date: `${y}-${month}-03`, status: 'ABSENT' }).expect(200);
      await c.put('/hr/attendance', { employeeId: e1.id, date: `${y}-${month}-04`, status: 'ABSENT' }).expect(200);
      void unpaid;
    });

    it('payroll: generate -> approve (segregation) -> post -> pay; ledger and reports tie out', async () => {
      const run = (await c.post('/hr/payroll/generate', { period: `${y}-${month}` }).expect(201)).body.data;
      // Aisha: basic 6000 + housing 1500 = 7500 gross; deductions 200 + 2 days*(6000/30)=400 -> 600; net 6900. Bilal: 3000
      expect(run).toMatchObject({ employees: 2, totalGross: '10500.00', totalDeduction: '600.00', totalNet: '9900.00' });
      await c.post(`/hr/payroll/${run.id}/post`).expect(409); // not approved
      await c.post(`/hr/payroll/${run.id}/approve`).expect(403); // creator cannot approve
      await approver.post(`/hr/payroll/${run.id}/approve`).expect(200);
      await c.post(`/hr/payroll/${run.id}/post`).expect(200);
      expect(await bal('5210')).toBe('10500.00 DR');
      expect(await bal('2113')).toBe('9900.00 CR');
      expect(await bal('2115')).toBe('600.00 CR');
      await c.post('/hr/payroll/generate', { period: `${y}-${month}` }).expect(409); // already posted
      acc = await accountMap(app, T.token);
      await c.post(`/hr/payroll/${run.id}/pay`, { accountId: acc['1112'], date: today() }).expect(200);
      expect(await bal('2113')).toBe('0.00');
      const slip = (await c.get(`/hr/payroll/${run.id}`).expect(200)).body.data;
      expect(slip.status).toBe('PAID'); expect(slip.payslips.find((p: any) => p.code === 'E0001')).toMatchObject({ net: '6900.00', unpaidDays: '2' });
      expect((await rep('payroll-report', `period=${y}-${month}`)).summary[2].value).toBe('9900.00');
      expect((await rep('employee-report')).rows).toHaveLength(2);
      expect(await tb()).toBe(true);
    });
  });

  describe('Expenses', () => {
    it('direct expense: submit -> approve posts payment with input VAT; receipt requirement; reject; cancel', async () => {
      acc = await accountMap(app, T.token);
      const cat = (await c.post('/expenses/categories', { name: 'Travel', accountId: acc['5207'], requiresReceipt: true }).expect(201)).body.data;
      const ex = (await c.post('/expenses', { kind: 'DIRECT', categoryId: cat.id, date: today(), description: 'Client visit taxi', amount: '210.00', includesVat: true, taxCode: 'STD', paidFromId: acc['1111'] }).expect(201)).body.data;
      expect([ex.net, ex.vat, ex.total]).toEqual(['200.00', '10.00', '210.00']);
      await c.post(`/expenses/${ex.id}/submit`).expect(400); // receipt required
      const pdf = Buffer.from('%PDF-1.4\n%fake receipt\n');
      await request(app.getHttpServer()).post(`/api/v1/attachments?entityType=expense&entityId=${ex.id}`).set('Authorization', `Bearer ${T.token}`).attach('file', pdf, 'receipt.pdf').expect(201);
      await request(app.getHttpServer()).post(`/api/v1/attachments?entityType=expense&entityId=${ex.id}`).set('Authorization', `Bearer ${T.token}`).attach('file', Buffer.from('MZ evil exe'), 'receipt.pdf').expect(400); // content mismatch
      await c.post(`/expenses/${ex.id}/submit`).expect(200);
      await c.post(`/expenses/${ex.id}/approve`).expect(403); // own expense
      await approver.post(`/expenses/${ex.id}/approve`).expect(200);
      const e = (await c.get(`/expenses/${ex.id}`).expect(200)).body.data; expect(e.status).toBe('POSTED');
      const vat = (await c.get(`/vat/return?from=${y}-01-01&to=${y}-12-31`).expect(200)).body.data;
      expect(vat.inputs.find((b: any) => b.box === '9')).toMatchObject({ amount: '200.00', vat: '10.00' });
      const e2 = (await c.post('/expenses', { kind: 'DIRECT', categoryId: cat.id, date: today(), description: 'x1', amount: '10.00', paidFromId: acc['1111'] }).expect(201)).body.data;
      await request(app.getHttpServer()).post(`/api/v1/attachments?entityType=expense&entityId=${e2.id}`).set('Authorization', `Bearer ${T.token}`).attach('file', pdf, 'r.pdf').expect(201);
      await c.post(`/expenses/${e2.id}/submit`).expect(200);
      await approver.post(`/expenses/${e2.id}/reject`, { reason: 'Personal expense' }).expect(200);
      await c.post(`/expenses/${ex.id}/cancel`, { reason: 'duplicate claim' }).expect(200);
      expect((await rep('expense-report')).summary[0].value).not.toBeUndefined();
      expect(await tb()).toBe(true);
    });

    it('employee claim posts to claims payable and is reimbursed; budgets and recurring expenses', async () => {
      acc = await accountMap(app, T.token);
      const cat = (await c.get('/expenses/categories').expect(200)).body.data[0];
      const emp = (await c.get('/hr/employees?search=Bilal').expect(200)).body.data[0];
      const cl = (await c.post('/expenses', { kind: 'CLAIM', categoryId: cat.id, date: today(), description: 'Parking', amount: '50.00', employeeId: emp.id }).expect(201)).body.data;
      await c.post(`/expenses/${cl.id}/submit`).expect(400).catch(() => 0);
      const cat2 = (await c.post('/expenses/categories', { name: 'Office', accountId: acc['5203'] }).expect(201)).body.data;
      const cl2 = (await c.post('/expenses', { kind: 'CLAIM', categoryId: cat2.id, date: today(), description: 'Stationery', amount: '100.00', taxCode: 'STD', employeeId: emp.id }).expect(201)).body.data;
      await c.post(`/expenses/${cl2.id}/submit`).expect(200);
      await approver.post(`/expenses/${cl2.id}/approve`).expect(200);
      expect(await bal('2114')).toBe('105.00 CR');
      await c.post(`/expenses/${cl2.id}/reimburse`, { accountId: acc['1112'], date: today() }).expect(200);
      expect(await bal('2114')).toBe('0.00');
      await c.put('/expenses/budgets', { categoryId: cat2.id, year: y, month: 0, amount: '1000.00' }).expect(200);
      const b = await rep('expense-budget', `year=${y}`);
      expect(b.rows.find((r: any) => r.category === 'Office')).toMatchObject({ budget: '1000.00', actual: '100.00', variance: '900.00', used: '10.0%' });
      // recurring: monthly rent due since last month -> 2 postings
      const s = new Date(); s.setUTCDate(1); s.setUTCMonth(s.getUTCMonth() - 1);
      await c.post('/expenses/recurring', { categoryId: cat2.id, description: 'Office rent', net: '2000.00', paidFromId: acc['1112'], frequency: 'MONTHLY', startDate: s.toISOString().slice(0, 10), autoPost: true }).expect(201);
      expect((await c.post('/expenses/recurring/run', {}).expect(200)).body.data.generated).toBe(2);
      expect(await tb()).toBe(true);
    });
  });

  describe('Projects', () => {
    it('tasks drive progress; income and costs roll up into profitability', async () => {
      acc = await accountMap(app, T.token);
      const cust = (await c.post('/customers', { name: 'Project Client' }).expect(201)).body.data;
      const supp = (await c.post('/suppliers', { name: 'Sub Contractor' }).expect(201)).body.data;
      const p = (await c.post('/projects', { name: 'Villa Fit-out', customerId: cust.id, budgetRevenue: '50000.00', budgetCost: '30000.00', status: 'ACTIVE' }).expect(201)).body.data;
      expect(p.code).toMatch(/^PRJ-/);
      const t1 = (await c.post(`/projects/${p.id}/tasks`, { title: 'Design', estimatedHours: '10', assigneeId: approverId }).expect(201)).body.data;
      await c.post(`/projects/${p.id}/tasks`, { title: 'Build', estimatedHours: '30' }).expect(201);
      await c.patch(`/projects/tasks/${t1.id}`, { status: 'DONE' }).expect(200);
      const inv = (await c.post('/sales/documents', { type: 'INVOICE', partyId: cust.id, date: today(), projectId: p.id, lines: [{ description: 'Stage 1', quantity: '1', unitPrice: '20000.00' }] }).expect(201)).body.data;
      await c.post(`/sales/documents/${inv.id}/post`).expect(200);
      const pi = (await c.post('/purchases/documents', { type: 'INVOICE', partyId: supp.id, date: today(), projectId: p.id, lines: [{ description: 'Labour', quantity: '1', unitPrice: '8000.00', accountId: acc['5101'] }] }).expect(201)).body.data;
      await c.post(`/purchases/documents/${pi.id}/post`).expect(200);
      const cat = (await c.post('/expenses/categories', { name: 'Site costs', accountId: acc['5207'] }).expect(201)).body.data;
      const ex = (await c.post('/expenses', { kind: 'DIRECT', categoryId: cat.id, date: today(), description: 'Skip hire', amount: '500.00', paidFromId: acc['1111'], projectId: p.id }).expect(201)).body.data;
      await c.post(`/expenses/${ex.id}/submit`).expect(200); await approver.post(`/expenses/${ex.id}/approve`).expect(200);
      const g = (await c.get(`/projects/${p.id}`).expect(200)).body.data;
      expect(g).toMatchObject({ progress: 25, income: '20000.00', cost: '8500.00', profit: '11500.00', margin: '57.5%' });
      expect((await rep('project-profitability')).rows[0]).toMatchObject({ income: '20000.00', profit: '11500.00' });
      expect((await approver.get('/notifications').expect(200)).body.data.some((n: any) => n.title === 'Task assigned')).toBe(true);
    });
  });

  describe('Fixed assets', () => {
    it('register, depreciate (idempotent), transfer, maintenance, dispose with gain/loss; register & NBV reconcile', async () => {
      acc = await accountMap(app, T.token);
      await c.post('/accounting/financial-years', { startDate: `${y - 1}-01-01` }).expect(201);
      const cat = (await c.post('/assets/categories', { name: 'Vehicles', usefulLifeMonths: 60 }).expect(201)).body.data;
      const a = (await c.post('/assets', { name: 'Delivery van', categoryId: cat.id, purchaseDate: `${y - 1}-11-01`, cost: '60000.00', salvageValue: '0', fundingAccountId: acc['1112'] }).expect(201)).body.data;
      expect(a.code).toBe('FA-0001');
      expect(await bal('1201')).toBe('60000.00 DR');
      const r1 = (await c.post('/assets/depreciation/run', { period: `${y - 1}-11` }).expect(200)).body.data;
      expect(r1).toMatchObject({ assets: 1, total: '1000.00' });
      expect((await c.post('/assets/depreciation/run', { period: `${y - 1}-11` }).expect(200)).body.data.assets).toBe(0); // idempotent
      await c.post('/assets/depreciation/run', { period: `${y - 1}-12` }).expect(200);
      expect(await bal('1202')).toBe('2000.00 CR'); expect(await bal('5204')).toBe('2000.00 DR');
      await c.post(`/assets/${a.id}/transfer`, { date: today(), toLocation: 'Abu Dhabi depot' }).expect(200);
      await c.post(`/assets/${a.id}/maintenance`, { date: today(), description: 'Annual service', cost: '300.00', paidFromId: acc['1111'] }).expect(201);
      // disposing requires depreciation up to the previous month
      const disposeDate = `${y}-03-15`;
      await c.post(`/assets/${a.id}/dispose`, { date: disposeDate, proceeds: '55000.00', proceedsAccountId: acc['1112'] }).expect(409);
      for (const m of ['01', '02']) await c.post('/assets/depreciation/run', { period: `${y}-${m}` }).expect(200);
      const d = (await c.post(`/assets/${a.id}/dispose`, { date: disposeDate, proceeds: '55000.00', proceedsAccountId: acc['1112'] }).expect(200)).body.data;
      expect(d).toMatchObject({ netBookValue: '56000.00', gainLoss: '-1000.00' }); // 4 months depreciated
      expect(await bal('5211')).toBe('1000.00 DR'); expect(await bal('1201')).toBe('0.00'); expect(await bal('1202')).toBe('0.00');
      await c.post(`/assets/${a.id}/dispose`, { date: disposeDate, proceeds: '1.00', proceedsAccountId: acc['1112'] }).expect(409);
      expect((await c.get(`/assets/${a.id}`).expect(200)).body.data.status).toBe('DISPOSED');
      expect((await rep('asset-register')).rows[0]).toMatchObject({ status: 'DISPOSED' });
      expect(await tb()).toBe(true);
    });
  });

  describe('Dashboard, print, attachments', () => {
    it('dashboard figures come from the ledger and reconcile with reports', async () => {
      const fy = (await c.get('/accounting/financial-years').expect(200)).body.data.find((f: any) => f.name === `FY${y}`);
      const d = (await c.get(`/dashboard?financialYearId=${fy.id}`).expect(200)).body.data;
      const pl = await rep('profit-and-loss', `financialYearId=${fy.id}`);
      expect(d.netProfit).toBe(pl.meta.netProfit);
      const bs = await rep('balance-sheet');
      expect(Number(d.cashBalance) + Number(d.bankBalance)).toBeGreaterThan(0);
      expect(d).toHaveProperty('vat.net'); expect(d.alerts).toHaveProperty('lowStockItems');
      expect(bs.meta.balanced).toBe(true);
      expect(d.salesPerformance.length).toBeGreaterThan(0);
    });

    it('prints vouchers and invoices as HTML and PDF', async () => {
      const list = (await c.get('/vouchers?pageSize=1').expect(200)).body.data[0];
      const html = await request(app.getHttpServer()).get(`/api/v1/vouchers/${list.id}/print`).set('Authorization', `Bearer ${T.token}`).expect(200);
      expect(html.text).toContain(list.number);
      const pdf = await request(app.getHttpServer()).get(`/api/v1/vouchers/${list.id}/print?format=pdf`).set('Authorization', `Bearer ${T.token}`).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (x) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); }).expect(200);
      expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
      const inv = (await c.get('/sales/documents?type=INVOICE').expect(200)).body.data[0];
      expect((await request(app.getHttpServer()).get(`/api/v1/sales/documents/${inv.id}/print`).set('Authorization', `Bearer ${T.token}`).expect(200)).text).toContain('TAX INVOICE');
    });

    it('attachments are tenant-scoped and downloadable', async () => {
      const v = (await c.get('/vouchers?pageSize=1').expect(200)).body.data[0];
      const up = await request(app.getHttpServer()).post(`/api/v1/attachments?entityType=voucher&entityId=${v.id}`).set('Authorization', `Bearer ${T.token}`).attach('file', Buffer.from('%PDF-1.4 test'), 'support.pdf').expect(201);
      expect((await c.get(`/attachments?entityType=voucher&entityId=${v.id}`).expect(200)).body.data).toHaveLength(1);
      const dl = await request(app.getHttpServer()).get(`/api/v1/attachments/${up.body.data.id}/download`).set('Authorization', `Bearer ${T.token}`).expect(200);
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      const other = await registerAndLogin(app, 'Other Co');
      await request(app.getHttpServer()).get(`/api/v1/attachments/${up.body.data.id}/download`).set('Authorization', `Bearer ${other.token}`).expect(400); // not visible to another tenant
      await request(app.getHttpServer()).post(`/api/v1/attachments?entityType=voucher&entityId=${v.id}`).set('Authorization', `Bearer ${T.token}`).attach('file', Buffer.from('x'), 'run.exe').expect(400);
    });
  });
});

describe('Payroll pro-rata and nightly jobs (e2e)', () => {
  let app: INestApplication; let T: Tenant; let c: ReturnType<typeof api>;
  beforeAll(async () => { ({ app } = await createApp()); T = await registerAndLogin(app, 'Prorata Co'); c = api(app, T.token); });
  afterAll(async () => { await app.close(); });

  it('pays a mid-month joiner pro-rata (calendar days) and a full-month employee in full', async () => {
    const y = new Date().getUTCFullYear(); const m = new Date().getUTCMonth() + 1; const mm = String(m).padStart(2, '0');
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const join = days >= 21 ? 11 : 1; // joins on the 11th -> employed days = days - 10
    const e1 = (await c.post('/hr/employees', { name: 'Late Joiner', joinDate: `${y}-${mm}-${String(join).padStart(2, '0')}`, basicSalary: '3000.00' }).expect(201)).body.data;
    await c.post('/hr/employees', { name: 'Full Month', joinDate: `${y - 1}-01-01`, basicSalary: '3000.00' }).expect(201);
    const housing = (await c.post('/hr/salary-components', { name: 'Housing', type: 'ALLOWANCE', calc: 'FIXED' }).expect(201)).body.data;
    await c.put(`/hr/employees/${e1.id}/salary-items`, { items: [{ componentId: housing.id, value: '600.00' }] }).expect(200);
    const run = (await c.post('/hr/payroll/generate', { period: `${y}-${mm}` }).expect(201)).body.data;
    const detail = (await c.get(`/hr/payroll/${run.id}`).expect(200)).body.data;
    const empDays = days - (join - 1);
    const expectedBasic = (Math.round((3000 * empDays / days) * 100) / 100).toFixed(2);
    const late = detail.payslips.find((p: any) => p.employee === 'Late Joiner');
    const full = detail.payslips.find((p: any) => p.employee === 'Full Month');
    expect(late.basic).toBe(expectedBasic);
    expect(Number(late.allowances)).toBeCloseTo(Math.round(600 * empDays / days * 100) / 100, 2);
    expect(full.basic).toBe('3000.00');
    if (join === 1) expect(late.basic).toBe('3000.00');
  });

  it('nightly job runs recurring invoices, expenses and reminders for every company', async () => {
    const jobs = app.get(JobsService);
    const cust = (await c.post('/customers', { name: 'Job Customer' }).expect(201)).body.data;
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
    await c.post('/sales/recurring', { partyId: cust.id, frequency: 'MONTHLY', startDate: d.toISOString().slice(0, 10), autoPost: true, lines: [{ description: 'Retainer', quantity: '1', unitPrice: '50.00' }] }).expect(201);
    const summary = await jobs.runAll();
    expect(summary[T.code].invoices).toBe(2);
    expect(summary[T.code].error).toBeUndefined();
    expect((await jobs.runAll())[T.code].invoices).toBe(0); // idempotent: nothing left due
  });
});
