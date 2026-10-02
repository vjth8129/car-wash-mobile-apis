import request from 'supertest';
import { createApp } from '../../src/app';
import { db, pool } from '../../src/db';
import { carWashes } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { bearer, loginAs, uniquePhone } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

function onboardingBody(overrides: Record<string, unknown> = {}) {
  const stamp = Date.now();
  return {
    name: 'Aqua Shine',
    code: `AQUA${stamp}`,
    city: 'Kochi',
    owner: {
      name: 'Aqua Owner',
      phone: uniquePhone(),
      username: `aqua-owner-${stamp}`,
      password: 'Welcome@123',
    },
    ...overrides,
  };
}

describe('POST /car-washes (onboarding with an owner)', () => {
  it('creates the car wash and an owner who only sees their own car wash', async () => {
    const admin = await loginAs(app, 'superadmin', 'SuperAdmin@123');
    const body = onboardingBody();
    const created = await request(app)
      .post('/api/v1/car-washes')
      .set(...bearer(admin.accessToken))
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe(body.code.toUpperCase());
    expect(created.body.data.owner).toMatchObject({
      username: body.owner.username,
      phone: body.owner.phone,
    });
    expect(created.body.data.owner.passwordHash).toBeUndefined();

    // The owner signs in with their mobile number and must replace the given password.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: body.owner.phone, password: body.owner.password });
    expect(login.status).toBe(200);
    expect(login.body.data.user).toMatchObject({
      role: 'OWNER',
      carWashId: created.body.data.id,
      mustChangePassword: true,
    });
    const changed = await request(app)
      .post('/api/v1/auth/change-password')
      .set(...bearer(login.body.data.accessToken))
      .send({ currentPassword: body.owner.password, newPassword: 'AquaOwn@456' });
    expect(changed.status).toBe(200);
    const token = changed.body.data.accessToken;

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(...bearer(token));
    expect(me.body.data.carWash).toEqual({ id: created.body.data.id, name: 'Aqua Shine' });

    // A fresh tenant: none of Sparkle's services, users or customers are visible.
    const services = await request(app)
      .get('/api/v1/services')
      .set(...bearer(token));
    expect(services.status).toBe(200);
    expect(services.body.data).toEqual([]);

    const users = await request(app)
      .get('/api/v1/users')
      .set(...bearer(token));
    expect(users.body.data.map((u: any) => u.username)).toEqual([body.owner.username]);

    // And Sparkle's owner can't see the new owner.
    const sparkle = await loginAs(app, 'owner', 'Owner@123');
    const crossGet = await request(app)
      .get(`/api/v1/users/${created.body.data.owner.id}`)
      .set(...bearer(sparkle.accessToken));
    expect(crossGet.status).toBe(403);
  });

  it('still creates a car wash without an owner', async () => {
    const admin = await loginAs(app, 'superadmin', 'SuperAdmin@123');
    const { owner: _owner, ...body } = onboardingBody();
    const res = await request(app)
      .post('/api/v1/car-washes')
      .set(...bearer(admin.accessToken))
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.owner).toBeUndefined();
  });

  it('rejects an owner phone that is already registered, creating nothing', async () => {
    const admin = await loginAs(app, 'superadmin', 'SuperAdmin@123');
    const body = onboardingBody();
    body.owner.phone = '9000000101'; // Sparkle's owner
    const res = await request(app)
      .post('/api/v1/car-washes')
      .set(...bearer(admin.accessToken))
      .send(body);
    expect(res.status).toBe(409);
    const carWash = await db.query.carWashes.findFirst({
      where: eq(carWashes.code, body.code.toUpperCase()),
    });
    expect(carWash).toBeUndefined();
  });

  it('is platform-admin only', async () => {
    const owner = await loginAs(app, 'owner', 'Owner@123');
    const res = await request(app)
      .post('/api/v1/car-washes')
      .set(...bearer(owner.accessToken))
      .send(onboardingBody());
    expect(res.status).toBe(403);
  });
});
