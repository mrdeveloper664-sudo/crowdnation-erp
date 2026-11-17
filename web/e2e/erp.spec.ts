import { expect, test } from '@playwright/test';
import { TestCompany, createCompany, loginViaUi, pick } from './fixtures';

let company: TestCompany & { customerName: string };
const todayIso = new Date().toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { company = await createCompany(); });

test('login: wrong password is rejected, correct credentials reach the dashboard, logout returns to login', async ({ page, context }) => {
  await page.goto('/accounting/vouchers');
  await expect(page).toHaveURL(/\/login$/); // protected page redirects when signed out

  await page.getByLabel('Company code').fill(company.code);
  await page.getByLabel('Email').fill(company.email);
  await page.getByLabel('Password').fill('Wrong-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('div[role=alert]:not(#__next-route-announcer__)')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Password').fill(company.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // tokens live only in httpOnly cookies
  expect(await page.evaluate(() => document.cookie)).not.toContain('nx_');
  const cookies = await context.cookies();
  expect(cookies.filter((c) => c.name.startsWith('nx_')).every((c) => c.httpOnly)).toBe(true);
});

test('dashboard: shows the KPI cards and sections for a new company', async ({ page }) => {
  await loginViaUi(page, company);
  for (const label of ['Total revenue', 'Total expenses', 'Net profit', 'Cash balance', 'Bank balance', 'Receivables', 'Payables']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('Top customers')).toBeVisible();
  await expect(page.getByText('Needs attention')).toBeVisible();
});

test('journal voucher: unbalanced cannot be posted; balanced draft is saved, posted from its page and appears in the ledger', async ({ page }) => {
  await loginViaUi(page, company);
  await page.goto('/accounting/vouchers/new?type=JOURNAL');
  await expect(page.getByRole('heading', { name: 'New voucher' })).toBeVisible();
  await page.getByLabel('Narration').fill('E2E journal: rent paid from bank');

  const rows = page.locator('tbody tr');
  await pick(page, rows.nth(0), '5202'); // rent expense
  await rows.nth(0).getByRole('textbox').nth(1).fill('1500.00'); // debit (0=description,1=debit,2=credit)
  await pick(page, rows.nth(1), '1112'); // bank
  await rows.nth(1).getByRole('textbox').nth(2).fill('1400.00'); // credit - deliberately unbalanced
  await expect(page.getByText('Balanced ✓')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save & post' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.locator('div[role=alert]:not(#__next-route-announcer__)')).toContainText(/out of balance/i);

  await rows.nth(1).getByRole('textbox').nth(2).fill('1500.00');
  await expect(page.getByText('Balanced ✓')).toBeVisible();
  await page.getByRole('button', { name: 'Save as draft' }).click();

  await expect(page).toHaveURL(/\/accounting\/vouchers\/[0-9a-f-]{36}$/);
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('POSTED', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View posting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel (reverse)' })).toBeVisible(); // posted vouchers are only corrected by reversal
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);

  // journal entry page shows the immutable posting with both legs
  await page.getByRole('link', { name: 'View posting' }).click();
  await expect(page.getByText('1,500.00').first()).toBeVisible();

  // voucher list shows it as posted
  await page.goto('/accounting/vouchers');
  await expect(page.getByRole('row', { name: /JOURNAL|JV|Journal/i }).filter({ hasText: 'POSTED' }).first()).toBeVisible();
});

test('journal voucher: "Save & post" in one step', async ({ page }) => {
  await loginViaUi(page, company);
  await page.goto('/accounting/vouchers/new?type=JOURNAL');
  const rows = page.locator('tbody tr');
  await pick(page, rows.nth(0), '1111'); // cash
  await rows.nth(0).getByRole('textbox').nth(1).fill('250.50');
  await pick(page, rows.nth(1), '1112'); // bank
  await rows.nth(1).getByRole('textbox').nth(2).fill('250.50');
  await page.getByRole('button', { name: 'Save & post' }).click();
  await expect(page).toHaveURL(/\/accounting\/vouchers\/[0-9a-f-]{36}$/);
  await expect(page.getByText('POSTED', { exact: true })).toBeVisible();
});

test('sales invoice: create for a customer, post it, totals include 5% VAT and the dashboard receivables update', async ({ page }) => {
  await loginViaUi(page, company);
  await page.goto('/sales/documents/new?type=INVOICE');
  await pick(page, page.locator('label', { hasText: 'Customer' }), company.customerName);
  const line = page.locator('tbody tr').first();
  await line.getByRole('textbox').nth(0).fill('Consulting services'); // description
  await line.getByRole('textbox').nth(1).fill('2'); // qty
  await line.getByRole('textbox').nth(2).fill('500'); // unit price
  // estimate shown before saving: net 1,000.00 VAT 50.00 total 1,050.00
  await expect(line.getByText('1,050.00')).toBeVisible();
  await page.getByRole('button', { name: 'Save & post' }).click();

  await expect(page).toHaveURL(/\/sales\/documents\/[0-9a-f-]{36}$/);
  await expect(page.getByText('POSTED', { exact: true })).toBeVisible();
  const totals = page.locator('section', { hasText: 'Totals' });
  await expect(totals).toContainText('1,000.00');
  await expect(totals).toContainText('50.00');
  await expect(totals).toContainText('1,050.00');
  await expect(totals).toContainText('Outstanding');
  await expect(page.getByRole('link', { name: 'Record receipt' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^SV|^VCH|[A-Z]+-\d/ }).first()).toBeVisible(); // linked ledger voucher

  // list shows the invoice and the dashboard receivables reflect it
  await page.goto('/sales/documents?type=INVOICE');
  await expect(page.getByText(company.customerName).first()).toBeVisible();
  await page.goto('/');
  await expect(page.locator('div', { hasText: /^Receivables/ }).first()).toContainText('1,050.00');
});

test('reports: trial balance renders, balances, and exports to PDF / Excel / CSV', async ({ page }) => {
  await loginViaUi(page, company);
  await page.goto('/reports/trial-balance');
  await expect(page.getByRole('heading', { level: 1, name: 'Trial Balance' })).toBeVisible(); // page title comes from the report slug
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'TOTAL', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bank Account' })).toBeVisible();

  for (const [label, magic, mime] of [['PDF', '%PDF', /pdf/], ['Excel', 'PK', /spreadsheet|officedocument/], ['CSV', null, /csv/]] as const) {
    const href = await page.getByRole('link', { name: label, exact: true }).getAttribute('href');
    const res = await page.request.get(href!);
    expect(res.status(), label).toBe(200);
    expect(res.headers()['content-type'], label).toMatch(mime);
    const body = await res.body();
    if (magic) expect(body.subarray(0, magic.length).toString(), label).toBe(magic);
    else expect(body.toString()).toContain('Account');
  }
  // real browser download through the link
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Excel', exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
});

test('reports: trial balance totals are equal after the postings above (debit = credit)', async ({ page }) => {
  await loginViaUi(page, company);
  const res = await page.request.get(`/api/v1/reports/run/trial-balance?asOf=${todayIso}&pageSize=500`);
  expect(res.status()).toBe(200);
  const body = (await res.json()).data;
  const totalRow = body.rows.find((r: any) => r._kind === 'total');
  expect(totalRow).toBeTruthy();
  for (const [dr, cr] of [['openingDebit', 'openingCredit'], ['debit', 'credit'], ['closingDebit', 'closingCredit']]) expect(totalRow[dr], `${dr} = ${cr}`).toBe(totalRow[cr]);
  expect(totalRow.debit).toBe('2800.50'); // 1,500.00 + 250.50 (journals) + 1,050.00 (invoice incl. VAT)
});
