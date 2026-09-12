import request from 'supertest';
import { createApp } from '../../src/app';
import { db, pool } from '../../src/db';
import { carWashes, services, customers } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { loginAs, bearer } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

async function getCarWashBId(): Promise<string> {
  const carWash = await db.query.carWashes.findFirst({ where: eq(carWashes.code, 'SHINE002') });
  if (!carWash) throw new Error('Tenant B (SHINE002) fixture not found - check global setup');
  return carWash.id;
}

describe('Tenant isolation: Owner of Car Wash A vs Car Wash B', () => {
  it('cannot read services belonging to Car Wash B', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const carWashBId = await getCarWashBId();

    const [serviceB] = await db.select().from(services).where(eq(services.carWashId, carWashBId));
    expect(serviceB).toBeDefined();

    // Listing must never include tenant B's data.
    const listRes = await request(app)
      .get('/api/v1/services')
      .set(...bearer(accessToken));
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((s: any) => s.id === serviceB.id)).toBe(false);

    // Fetching tenant B's service by id directly must 404 (filtered out by carWashId scoping).
    const getRes = await request(app)
      .get(`/api/v1/services/${serviceB.id}`)
      .set(...bearer(accessToken));
    expect(getRes.status).toBe(404);
  });

  it('cannot read customers belonging to Car Wash B', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const carWashBId = await getCarWashBId();

    // Seed a customer directly under tenant B to prove owner A can't see it.
    const [customerB] = await db
      .insert(customers)
      .values({ carWashId: carWashBId, name: 'Tenant B Customer', phone: '+91-9111111111' })
      .returning();

    const listRes = await request(app)
      .get('/api/v1/customers')
      .set(...bearer(accessToken));
    expect(listRes.body.data.some((c: any) => c.id === customerB.id)).toBe(false);

    const getRes = await request(app)
      .get(`/api/v1/customers/${customerB.id}`)
      .set(...bearer(accessToken));
    expect(getRes.status).toBe(404);
  });

  it('cannot view or update Car Wash B itself', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const carWashBId = await getCarWashBId();

    const getRes = await request(app)
      .get(`/api/v1/car-washes/${carWashBId}`)
      .set(...bearer(accessToken));
    expect(getRes.status).toBe(403);

    const patchRes = await request(app)
      .patch(`/api/v1/car-washes/${carWashBId}`)
      .set(...bearer(accessToken))
      .send({ name: 'Hijacked Name' });
    expect(patchRes.status).toBe(403);
  });

  it('cannot view a user belonging to Car Wash B', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const ownerB = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'owner_b', password: 'OwnerB@123' });
    const ownerBId = ownerB.body.data.user.id;

    const res = await request(app)
      .get(`/api/v1/users/${ownerBId}`)
      .set(...bearer(accessToken));
    expect(res.status).toBe(403);
  });

  it('ignores any client-supplied carWashId and always scopes new users to the creator’s own tenant', async () => {
    const { accessToken, user } = await loginAs(app, 'owner', 'Owner@123');
    const carWashBId = await getCarWashBId();

    // Need a role id the owner is allowed to assign - use the STAFF system role.
    const staffRole = await db.query.roles.findFirst({
      where: (r, { eq: eqOp, and: andOp, isNull: isNullOp }) =>
        andOp(eqOp(r.name, 'STAFF'), isNullOp(r.carWashId)),
    });

    const createRes = await request(app)
      .post('/api/v1/users')
      .set(...bearer(accessToken))
      .send({
        username: `cross-tenant-attempt-${Date.now()}`,
        password: 'SomeValidPass@123',
        name: 'Cross Tenant Attempt',
        roleId: staffRole!.id,
        carWashId: carWashBId, // attempted injection - must be ignored
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.carWashId).toBe(user.carWashId);
    expect(createRes.body.data.carWashId).not.toBe(carWashBId);
  });

  it('cannot create a booking using a customer/vehicle/service id from Car Wash B', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const carWashBId = await getCarWashBId();

    const [serviceB] = await db.select().from(services).where(eq(services.carWashId, carWashBId));
    const [customerB] = await db
      .insert(customers)
      .values({ carWashId: carWashBId, name: 'Another B Customer', phone: '+91-9222222222' })
      .returning();

    const res = await request(app)
      .post('/api/v1/bookings')
      .set(...bearer(accessToken))
      .send({
        customerId: customerB.id,
        vehicleId: customerB.id, // irrelevant - request should fail before reaching vehicle check
        serviceId: serviceB.id,
        bookingDate: '2026-12-01',
        startTime: '09:00',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
