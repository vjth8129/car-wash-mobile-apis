import request from 'supertest';

jest.mock('../../src/utils/mailer', () => ({
  sendPasswordResetCodeEmail: jest.fn(async () => undefined),
  mailer: { send: jest.fn(async () => undefined) },
}));

import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { normalizePhone } from '../../src/utils/phone';
import { bearer, loginAs, uniquePhone } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

const OWNER_PHONE = '+919000000101'; // seeded Sparkle owner

describe('normalizePhone', () => {
  it.each([
    ['9000000101', OWNER_PHONE],
    ['90000 00101', OWNER_PHONE],
    ['+91 90000-00101', OWNER_PHONE],
    ['09000000101', OWNER_PHONE],
    ['919000000101', OWNER_PHONE],
    ['+1 (415) 555-0100', '+14155550100'],
  ])('normalises %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['12345', 'owner', '', '+0123456789'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('Sign in with mobile number', () => {
  it.each(['9000000101', '+91 90000 00101', '09000000101'])(
    'accepts the number typed as %s',
    async (phone) => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ phone, password: 'Owner@123' });
      expect(res.status).toBe(200);
      expect(res.body.data.user).toMatchObject({
        username: 'owner',
        phone: OWNER_PHONE,
        role: 'OWNER',
      });
    },
  );

  it('still accepts a username for older accounts', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'owner', password: 'Owner@123' });
    expect(res.status).toBe(200);
  });

  it('matches a phone typed into the username field (older clients)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: '9000000101', password: 'Owner@123' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe('owner');
  });

  it('rejects a wrong password or unknown number with the same message', async () => {
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: '9000000101', password: 'nope' });
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: '9555555555', password: 'Owner@123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('requires exactly one of phone / username', async () => {
    const neither = await request(app).post('/api/v1/auth/login').send({ password: 'x' });
    const both = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: '9000000101', username: 'owner', password: 'Owner@123' });
    expect(neither.status).toBe(400);
    expect(both.status).toBe(400);
  });

  it('resets a password by mobile number', async () => {
    const owner = await loginAs(app, 'owner', 'Owner@123');
    const roles = await request(app)
      .get('/api/v1/roles')
      .set(...bearer(owner.accessToken));
    const staffRole = roles.body.data.find((r: any) => r.name === 'STAFF');
    const phone = uniquePhone();
    const created = await request(app)
      .post('/api/v1/users')
      .set(...bearer(owner.accessToken))
      .send({
        username: `phone-reset-${Date.now()}`,
        phone,
        password: 'Temp@1234',
        name: 'Phone Reset',
        roleId: staffRole.id,
      });
    expect(created.status).toBe(201);

    const local = phone.slice(3); // the 10-digit number, as a user would type it
    await request(app).post('/api/v1/auth/forgot-password').send({ phone: local });
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ phone: local, code: '1111', newPassword: 'ByPhone@123' });
    expect(reset.status).toBe(200);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: local, password: 'ByPhone@123' });
    expect(login.status).toBe(200);
  });
});

describe('Mobile numbers on user accounts', () => {
  async function staffRoleAndToken() {
    const owner = await loginAs(app, 'owner', 'Owner@123');
    const roles = await request(app)
      .get('/api/v1/roles')
      .set(...bearer(owner.accessToken));
    return {
      token: owner.accessToken,
      roleId: roles.body.data.find((r: any) => r.name === 'STAFF').id as string,
    };
  }

  it('requires a valid mobile number when creating a user', async () => {
    const { token, roleId } = await staffRoleAndToken();
    const base = { password: 'Temp@1234', name: 'No Phone', roleId };
    const missing = await request(app)
      .post('/api/v1/users')
      .set(...bearer(token))
      .send({ ...base, username: `no-phone-${Date.now()}` });
    const invalid = await request(app)
      .post('/api/v1/users')
      .set(...bearer(token))
      .send({ ...base, username: `bad-phone-${Date.now()}`, phone: '12345' });
    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
  });

  it('stores the number normalised to E.164', async () => {
    const { token, roleId } = await staffRoleAndToken();
    const res = await request(app)
      .post('/api/v1/users')
      .set(...bearer(token))
      .send({
        username: `formatted-${Date.now()}`,
        phone: '+91 78123 45678',
        password: 'Temp@1234',
        name: 'Formatted Phone',
        roleId,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.phone).toBe('+917812345678');
  });

  it('rejects a number already used in another car wash', async () => {
    const { token, roleId } = await staffRoleAndToken();
    const res = await request(app)
      .post('/api/v1/users')
      .set(...bearer(token))
      .send({
        username: `dupe-phone-${Date.now()}`,
        phone: '9000000201', // owner_b of Shine Car Wash
        password: 'Temp@1234',
        name: 'Duplicate Phone',
        roleId,
      });
    expect(res.status).toBe(409);
  });
});
