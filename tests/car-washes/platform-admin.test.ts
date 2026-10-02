import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { bearer, loginAs, uniquePhone } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

async function adminToken() {
  return (await loginAs(app, 'superadmin', 'SuperAdmin@123')).accessToken;
}

/** Onboards a fresh car wash (with an owner who has already set their own password). */
async function onboard(token: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const owner = { name: 'Portal Owner', phone: uniquePhone(), username: `portal-owner-${stamp}` };
  const res = await request(app)
    .post('/api/v1/car-washes')
    .set(...bearer(token))
    .send({
      name: `Portal Wash ${stamp}`,
      code: `PW${stamp}`,
      owner: { ...owner, password: 'Temp@1234' },
    });
  expect(res.status).toBe(201);
  const first = await request(app)
    .post('/api/v1/auth/login')
    .send({ phone: owner.phone, password: 'Temp@1234' });
  await request(app)
    .post('/api/v1/auth/change-password')
    .set(...bearer(first.body.data.accessToken))
    .send({ currentPassword: 'Temp@1234', newPassword: 'OwnerPw@123' });
  return { carWash: res.body.data, owner: { ...owner, password: 'OwnerPw@123' } };
}

async function systemRoleId(token: string, name: string) {
  const roles = await request(app)
    .get('/api/v1/roles')
    .set(...bearer(token));
  return roles.body.data.find((r: any) => r.name === name).id as string;
}

describe('Platform admin portal endpoints', () => {
  it('returns platform stats to platform admins only', async () => {
    const token = await adminToken();
    const res = await request(app)
      .get('/api/v1/car-washes/stats')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      carWashes: { total: expect.any(Number), active: expect.any(Number) },
      users: { total: expect.any(Number), active: expect.any(Number) },
      orders: { today: expect.any(Number), last30Days: expect.any(Number) },
    });
    expect(res.body.data.carWashes.total).toBeGreaterThanOrEqual(2);

    const owner = await loginAs(app, 'owner', 'Owner@123');
    const denied = await request(app)
      .get('/api/v1/car-washes/stats')
      .set(...bearer(owner.accessToken));
    expect(denied.status).toBe(403);
  });

  it('lists car washes with user counts and searches by code', async () => {
    const token = await adminToken();
    const res = await request(app)
      .get('/api/v1/car-washes?search=sparkle001')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ code: 'SPARKLE001', userCount: expect.any(Number) });
    expect(res.body.data[0].userCount).toBeGreaterThanOrEqual(3);
  });

  it('suspending a car wash locks its users out until it is reactivated', async () => {
    const token = await adminToken();
    const { carWash, owner } = await onboard(token);
    const session = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: owner.phone, password: owner.password });
    expect(session.status).toBe(200);

    const suspend = await request(app)
      .patch(`/api/v1/car-washes/${carWash.id}`)
      .set(...bearer(token))
      .send({ status: 'SUSPENDED' });
    expect(suspend.status).toBe(200);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: owner.phone, password: owner.password });
    expect(login.status).toBe(401);
    const call = await request(app)
      .get('/api/v1/services')
      .set(...bearer(session.body.data.accessToken));
    expect(call.status).toBe(401);
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.body.data.refreshToken });
    expect(refresh.status).toBe(401);

    await request(app)
      .patch(`/api/v1/car-washes/${carWash.id}`)
      .set(...bearer(token))
      .send({ status: 'ACTIVE' });
    const again = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: owner.phone, password: owner.password });
    expect(again.status).toBe(200);
  });

  it('reactivates a deactivated (deleted) car wash', async () => {
    const token = await adminToken();
    const { carWash } = await onboard(token);
    await request(app)
      .delete(`/api/v1/car-washes/${carWash.id}`)
      .set(...bearer(token));
    const res = await request(app)
      .patch(`/api/v1/car-washes/${carWash.id}`)
      .set(...bearer(token))
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ACTIVE', deletedAt: null });
  });

  it('lists and adds users for a chosen car wash', async () => {
    const token = await adminToken();
    const { carWash, owner } = await onboard(token);

    const created = await request(app)
      .post('/api/v1/users')
      .set(...bearer(token))
      .send({
        carWashId: carWash.id,
        username: `portal-manager-${Date.now()}`,
        phone: uniquePhone(),
        password: 'Temp@1234',
        name: 'Portal Manager',
        roleId: await systemRoleId(token, 'MANAGER'),
      });
    expect(created.status).toBe(201);
    expect(created.body.data.carWashId).toBe(carWash.id);

    const list = await request(app)
      .get(`/api/v1/users?carWashId=${carWash.id}`)
      .set(...bearer(token));
    expect(list.body.data.map((u: any) => u.username).sort()).toEqual(
      [owner.username, created.body.data.username].sort(),
    );
  });

  it('rejects a platform-admin role inside a car wash, and a car-wash role without one', async () => {
    const token = await adminToken();
    const { carWash } = await onboard(token);
    const base = { password: 'Temp@1234', name: 'Wrong Role' };
    const superInWash = await request(app)
      .post('/api/v1/users')
      .set(...bearer(token))
      .send({
        ...base,
        carWashId: carWash.id,
        username: `sa-in-wash-${Date.now()}`,
        phone: uniquePhone(),
        roleId: await systemRoleId(token, 'SUPER_ADMIN'),
      });
    const staffNoWash = await request(app)
      .post('/api/v1/users')
      .set(...bearer(token))
      .send({
        ...base,
        username: `staff-no-wash-${Date.now()}`,
        phone: uniquePhone(),
        roleId: await systemRoleId(token, 'STAFF'),
      });
    expect(superInWash.status).toBe(403);
    expect(staffNoWash.status).toBe(403);
  });

  it('ignores carWashId from a tenant user (always their own car wash)', async () => {
    const admin = await adminToken();
    const { carWash: other } = await onboard(admin);
    const owner = await loginAs(app, 'owner', 'Owner@123');
    const res = await request(app)
      .post('/api/v1/users')
      .set(...bearer(owner.accessToken))
      .send({
        carWashId: other.id,
        username: `smuggled-${Date.now()}`,
        phone: uniquePhone(),
        password: 'Temp@1234',
        name: 'Smuggled',
        roleId: await systemRoleId(owner.accessToken, 'STAFF'),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.carWashId).toBe(owner.user.carWashId);

    const filtered = await request(app)
      .get(`/api/v1/users?carWashId=${other.id}`)
      .set(...bearer(owner.accessToken));
    expect(filtered.body.data.every((u: any) => u.carWashId === owner.user.carWashId)).toBe(true);
  });
});
