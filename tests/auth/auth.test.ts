import request from 'supertest';

jest.mock('../../src/utils/mailer', () => ({
  sendPasswordResetEmail: jest.fn(async () => undefined),
  mailer: { send: jest.fn(async () => undefined) },
}));

import { createApp } from '../../src/app';
import { sendPasswordResetEmail } from '../../src/utils/mailer';
import { db, pool } from '../../src/db';
import { passwordResetTokens, users, roles } from '../../src/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { hashToken } from '../../src/utils/tokens';
import { hashPassword } from '../../src/utils/password';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

async function createResetTestUser() {
  const ownerRole = await db.query.roles.findFirst({
    where: and(eq(roles.name, 'OWNER'), isNull(roles.carWashId)),
  });
  const carWash = await db.query.carWashes.findFirst();
  const [user] = await db
    .insert(users)
    .values({
      username: `reset-test-user-${Date.now()}`,
      passwordHash: await hashPassword('OriginalPass@123'),
      name: 'Reset Test User',
      email: 'reset-test-user@example.com',
      roleId: ownerRole!.id,
      carWashId: carWash!.id,
      status: 'ACTIVE',
    })
    .returning();
  return user;
}

describe('POST /api/v1/auth/login', () => {
  it('logs in successfully with valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'owner', password: 'Owner@123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ username: 'owner', role: 'OWNER' });
    expect(res.body.data.user.carWashId).toEqual(expect.any(String));
  });

  it('rejects an unknown username', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'does-not-exist', password: 'whatever123' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'owner', password: 'WrongPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a malformed request body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'owner' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user context for a valid token', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'owner', password: 'Owner@123' });
    const token = login.body.data.accessToken;

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('owner');
    expect(res.body.data.role.name).toBe('OWNER');
    expect(res.body.data.permissions).toEqual(expect.arrayContaining(['SERVICES_VIEW']));
    expect(res.body.data.carWash.name).toBe('Sparkle Car Wash');
  });
});

describe('POST /api/v1/auth/refresh + logout', () => {
  it('issues a new token pair and rotates the refresh token', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'manager', password: 'Manager@123' });
    const oldRefreshToken = login.body.data.refreshToken;

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toEqual(expect.any(String));
    expect(refreshRes.body.data.refreshToken).not.toBe(oldRefreshToken);

    // The old (rotated-out) refresh token must no longer be usable.
    const reuseRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefreshToken });
    expect(reuseRes.status).toBe(401);
  });

  it('revokes the refresh token on logout', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'staff', password: 'Staff@123' });
    const { refreshToken } = login.body.data;

    const logoutRes = await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect(logoutRes.status).toBe(200);

    const refreshAfterLogout = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });
});

describe('Forgot / reset password', () => {
  it('always returns a generic success response, whether or not the username exists', async () => {
    const known = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ username: 'owner' });
    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ username: 'nobody-such-user' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.data.message).toBe(unknown.body.data.message);
  });

  it('resets the password with a valid token and invalidates it after use', async () => {
    const testUser = await createResetTestUser();
    await request(app).post('/api/v1/auth/forgot-password').send({ username: testUser.username });

    expect(sendPasswordResetEmail).toHaveBeenCalled();
    const [, resetLink] = (sendPasswordResetEmail as jest.Mock).mock.calls.at(-1) as [
      string,
      string,
    ];
    const token = new URL(resetLink).searchParams.get('token')!;
    expect(token).toEqual(expect.any(String));

    const newPassword = 'NewResetPass@123';
    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword });
    expect(resetRes.status).toBe(200);

    // Old password no longer works, new one does.
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: testUser.username, password: 'OriginalPass@123' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: testUser.username, password: newPassword });
    expect(newLogin.status).toBe(200);

    // Token is one-time-use: reusing it must fail even though it hasn't expired.
    const reuseRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'AnotherPass@123' });
    expect(reuseRes.status).toBe(400);
  });

  it('rejects an expired reset token', async () => {
    const testUser = await createResetTestUser();

    const secret = 'expired-secret-for-testing-only';
    const [row] = await db
      .insert(passwordResetTokens)
      .values({
        userId: testUser.id,
        tokenHash: hashToken(secret),
        expiresAt: new Date(Date.now() - 60 * 1000), // already expired
      })
      .returning();

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: `${row.id}.${secret}`, newPassword: 'SomeNewPass@123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
