import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app';
import { db, pool } from '../../src/db';
import { carWashAddresses } from '../../src/db/schema';
import { bearer, loginAs, uniquePhone } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

function signupBody(overrides: Record<string, unknown> = {}) {
  return {
    name: `Shine Hub ${Date.now()}`,
    phone: '080 4123 4567',
    gstNumber: '29abcde1234f1z5',
    address: '12, 4th Cross, Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560038',
    latitude: 12.9719,
    longitude: 77.6412,
    owner: { name: 'Shine Owner', phone: uniquePhone(), password: 'Shine@1234' },
    ...overrides,
  };
}

describe('POST /auth/signup (car wash self sign-up)', () => {
  it('creates a pending car wash whose owner can sign in once an admin approves it', async () => {
    const body = signupBody();
    const res = await request(app).post('/api/v1/auth/signup').send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.carWash).toMatchObject({ name: body.name, status: 'PENDING' });
    expect(res.body.data.message).toMatch(/under review.*2 hours/i);
    const carWashId = res.body.data.carWash.id as string;

    // The address lives in its own table, keyed by the car wash.
    const address = await db.query.carWashAddresses.findFirst({
      where: eq(carWashAddresses.carWashId, carWashId),
    });
    expect(address).toMatchObject({ city: 'Bengaluru', latitude: 12.9719, longitude: 77.6412 });

    // Until reviewed, the right password gets the "under review" answer.
    const pending = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: body.owner.phone, password: body.owner.password });
    expect(pending.status).toBe(403);
    expect(pending.body.error.code).toBe('CAR_WASH_PENDING');
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: body.owner.phone, password: 'Wrong@1234' });
    expect(wrong.status).toBe(401);

    // The platform admin sees it in the pending list with GSTIN, location and owner.
    const admin = await loginAs(app, 'superadmin', 'SuperAdmin@123');
    const list = await request(app)
      .get('/api/v1/car-washes?status=PENDING')
      .set(...bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(carWashId);
    const detail = await request(app)
      .get(`/api/v1/car-washes/${carWashId}`)
      .set(...bearer(admin.accessToken));
    expect(detail.body.data).toMatchObject({
      status: 'PENDING',
      source: 'SELF_SIGNUP',
      gstNumber: '29ABCDE1234F1Z5',
      city: 'Bengaluru',
      latitude: 12.9719,
      phone: '+918041234567',
    });
    expect(detail.body.data.owners).toEqual([
      expect.objectContaining({ name: 'Shine Owner', phone: body.owner.phone }),
    ]);
    const stats = await request(app)
      .get('/api/v1/car-washes/stats')
      .set(...bearer(admin.accessToken));
    expect(stats.body.data.carWashes.pending).toBeGreaterThanOrEqual(1);

    const approve = await request(app)
      .patch(`/api/v1/car-washes/${carWashId}`)
      .set(...bearer(admin.accessToken))
      .send({ status: 'ACTIVE' });
    expect(approve.status).toBe(200);

    // The owner chose their own password, so no forced change after approval.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: body.owner.phone, password: body.owner.password });
    expect(login.status).toBe(200);
    expect(login.body.data.user).toMatchObject({
      role: 'OWNER',
      carWashId,
      mustChangePassword: false,
    });
  });

  it('keeps the address in sync when an admin edits the profile', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send(signupBody());
    const carWashId = res.body.data.carWash.id as string;
    const admin = await loginAs(app, 'superadmin', 'SuperAdmin@123');
    const updated = await request(app)
      .patch(`/api/v1/car-washes/${carWashId}`)
      .set(...bearer(admin.accessToken))
      .send({ city: 'Mysuru', name: 'Shine Hub Mysuru' });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      name: 'Shine Hub Mysuru',
      city: 'Mysuru',
      state: 'Karnataka',
    });
  });

  it('gives each sign-up a unique code, even with the same name', async () => {
    const name = `Twin Wash ${Date.now()}`;
    const a = await request(app).post('/api/v1/auth/signup').send(signupBody({ name }));
    const b = await request(app).post('/api/v1/auth/signup').send(signupBody({ name }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.carWash.code).not.toBe(b.body.data.carWash.code);
  });

  it('requires a valid GSTIN and the shop location', async () => {
    const badGst = await request(app)
      .post('/api/v1/auth/signup')
      .send(signupBody({ gstNumber: '12345' }));
    expect(badGst.status).toBe(400);
    const { latitude: _lat, longitude: _lng, ...noLocation } = signupBody();
    const missing = await request(app).post('/api/v1/auth/signup').send(noLocation);
    expect(missing.status).toBe(400);
  });

  it('rejects a mobile number that already has an account', async () => {
    const body = signupBody();
    await request(app).post('/api/v1/auth/signup').send(body);
    const again = await request(app)
      .post('/api/v1/auth/signup')
      .send(signupBody({ owner: body.owner }));
    expect(again.status).toBe(409);
  });

  it('admins cannot put a car wash back into review', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send(signupBody());
    const admin = await loginAs(app, 'superadmin', 'SuperAdmin@123');
    const set = await request(app)
      .patch(`/api/v1/car-washes/${res.body.data.carWash.id}`)
      .set(...bearer(admin.accessToken))
      .send({ status: 'PENDING' });
    expect(set.status).toBe(400);
  });
});
