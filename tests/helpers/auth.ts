import { Application } from 'express';
import request from 'supertest';

export interface LoggedInUser {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; name: string; role: string; carWashId: string | null };
}

export async function loginAs(
  app: Application,
  username: string,
  password: string,
): Promise<LoggedInUser> {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}
