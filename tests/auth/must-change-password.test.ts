import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { loginAs, bearer, uniquePhone } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

async function createUserAsOwner(password: string) {
  const owner = await loginAs(app, 'owner', 'Owner@123');
  const roles = await request(app)
    .get('/api/v1/roles')
    .set(...bearer(owner.accessToken));
  const staffRole = roles.body.data.find((r: any) => r.name === 'STAFF');
  const username = `mcp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const res = await request(app)
    .post('/api/v1/users')
    .set(...bearer(owner.accessToken))
    .send({ username, phone: uniquePhone(), password, name: 'New Starter', roleId: staffRole.id });
  expect(res.status).toBe(201);
  return { username, id: res.body.data.id, ownerToken: owner.accessToken };
}

describe('Admin-set passwords must be changed', () => {
  it('forces a new user to change the password the owner chose', async () => {
    const { username } = await createUserAsOwner('Temp@1234');

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password: 'Temp@1234' });
    expect(login.status).toBe(200);
    expect(login.body.data.user.mustChangePassword).toBe(true);
    const token = login.body.data.accessToken;

    // Everything except /auth/me and /auth/change-password is blocked until changed.
    const blocked = await request(app)
      .get('/api/v1/services')
      .set(...bearer(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(...bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(true);

    const wrongCurrent = await request(app)
      .post('/api/v1/auth/change-password')
      .set(...bearer(token))
      .send({ currentPassword: 'nope', newPassword: 'MyOwn@5678' });
    expect(wrongCurrent.status).toBe(400);

    const sameAsBefore = await request(app)
      .post('/api/v1/auth/change-password')
      .set(...bearer(token))
      .send({ currentPassword: 'Temp@1234', newPassword: 'Temp@1234' });
    expect(sameAsBefore.status).toBe(400);

    const changed = await request(app)
      .post('/api/v1/auth/change-password')
      .set(...bearer(token))
      .send({ currentPassword: 'Temp@1234', newPassword: 'MyOwn@5678' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.accessToken).toEqual(expect.any(String));
    expect(changed.body.data.refreshToken).toEqual(expect.any(String));

    const allowed = await request(app)
      .get('/api/v1/services')
      .set(...bearer(changed.body.data.accessToken));
    expect(allowed.status).toBe(200);

    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password: 'MyOwn@5678' });
    expect(relogin.body.data.user.mustChangePassword).toBe(false);
  });

  it('requires a change again after an owner resets the password', async () => {
    const { username, id, ownerToken } = await createUserAsOwner('Temp@1234');
    const first = await loginAs(app, username, 'Temp@1234');
    await request(app)
      .post('/api/v1/auth/change-password')
      .set(...bearer(first.accessToken))
      .send({ currentPassword: 'Temp@1234', newPassword: 'MyOwn@5678' });

    const reset = await request(app)
      .post(`/api/v1/users/${id}/reset-password`)
      .set(...bearer(ownerToken))
      .send({ newPassword: 'Reset@9999' });
    expect(reset.status).toBe(200);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password: 'Reset@9999' });
    expect(login.body.data.user.mustChangePassword).toBe(true);
  });
});
