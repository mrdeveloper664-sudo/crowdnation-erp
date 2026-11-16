import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/common/mail.service';
import { configureApp } from '../src/setup';

export const PASSWORD = 'Str0ngPassw0rd!';

export async function createApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, mail: app.get(MailService) };
}

let counter = 0;
export const uniq = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`.toUpperCase().slice(0, 30);

export interface Tenant { code: string; email: string; token: string; refresh: string; companyId: string; userId: string }

export async function registerAndLogin(app: INestApplication, name = 'Acme Trading'): Promise<Tenant> {
  const code = uniq('T');
  const email = `admin@${code.toLowerCase()}.test`;
  const reg = await request(app.getHttpServer()).post('/api/v1/auth/register-company').send({
    companyName: name, companyCode: code, adminName: 'Admin', adminEmail: email, password: PASSWORD,
  }).expect(201);
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ companyCode: code, email, password: PASSWORD }).expect(200);
  return { code, email, token: login.body.data.accessToken, refresh: login.body.data.refreshToken, companyId: reg.body.data.companyId, userId: reg.body.data.userId };
}

export const api = (app: INestApplication, token: string) => ({
  get: (url: string) => request(app.getHttpServer()).get(`/api/v1${url}`).set('Authorization', `Bearer ${token}`),
  post: (url: string, body: object = {}) => request(app.getHttpServer()).post(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body),
  put: (url: string, body: object = {}) => request(app.getHttpServer()).put(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body),
  patch: (url: string, body: object = {}) => request(app.getHttpServer()).patch(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body),
  del: (url: string) => request(app.getHttpServer()).delete(`/api/v1${url}`).set('Authorization', `Bearer ${token}`),
});

/** Map of account code -> id for the default chart. */
export async function accountMap(app: INestApplication, token: string): Promise<Record<string, string>> {
  const r = await api(app, token).get('/chart-of-accounts/accounts').expect(200);
  return Object.fromEntries(r.body.data.map((a: any) => [a.code, a.id]));
}

export const today = () => new Date().toISOString().slice(0, 10);
