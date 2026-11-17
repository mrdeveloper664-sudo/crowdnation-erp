import { APIRequestContext, Locator, Page, expect, request } from '@playwright/test';

export const API = `http://localhost:${process.env.E2E_API_PORT ?? '4100'}/api/v1`;
export const PASSWORD = 'Str0ngPassw0rd!';

export interface TestCompany { code: string; email: string; password: string }

/** Registers a throw-away company directly on the API (never touches existing companies) and adds one customer. */
export async function createCompany(): Promise<TestCompany & { customerName: string }> {
  const code = ('E' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)).toUpperCase().slice(0, 20);
  const email = `admin@${code.toLowerCase()}.test`;
  const api: APIRequestContext = await request.newContext({ baseURL: API + '/' });
  const reg = await api.post('auth/register-company', { data: { companyName: `E2E Trading ${code}`, companyCode: code, adminName: 'E2E Admin', adminEmail: email, password: PASSWORD } });
  expect(reg.status(), await reg.text()).toBe(201);
  const login = await api.post('auth/login', { data: { companyCode: code, email, password: PASSWORD } });
  const token = (await login.json()).data.accessToken;
  const customerName = `Customer ${code}`;
  const cust = await api.post('customers', { data: { name: customerName }, headers: { Authorization: `Bearer ${token}` } });
  expect(cust.status(), await cust.text()).toBe(201);
  await api.dispose();
  return { code, email, password: PASSWORD, customerName };
}

/** Logs in through the real login form. */
export async function loginViaUi(page: Page, c: TestCompany) {
  await page.goto('/login');
  await page.getByLabel('Company code').fill(c.code);
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Opens a Combobox (searchable dropdown) inside `scope`, searches and picks the first option containing `text`. */
export async function pick(page: Page, scope: Locator, search: string, text: string = search) {
  await scope.locator('button[aria-haspopup="listbox"]').click();
  await page.getByPlaceholder('Search…').fill(search);
  await page.getByRole('option', { name: new RegExp(text) }).first().click();
}
