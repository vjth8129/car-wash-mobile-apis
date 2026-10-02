import request from 'supertest';
import { createApp } from '../../src/app';
import { db, pool } from '../../src/db';
import { bookings, customers, services, vehicles } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { bearer, loginAs } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

/** A fresh booking + order (status CREATED, i.e. "Waiting") in Sparkle Car Wash. */
async function newOrder(token: string) {
  const me = await request(app)
    .get('/api/v1/auth/me')
    .set(...bearer(token));
  const carWashId = me.body.data.carWash.id;
  const userId = me.body.data.id;
  const [service] = await db.select().from(services).where(eq(services.carWashId, carWashId));
  const [customer] = await db
    .insert(customers)
    .values({ carWashId, name: 'Flow Customer', phone: `+9170${Date.now() % 100000000}` })
    .returning();
  const [vehicle] = await db
    .insert(vehicles)
    .values({
      carWashId,
      customerId: customer.id,
      registrationNumber: `KL07FW${Date.now() % 10000}`,
    })
    .returning();
  const [booking] = await db
    .insert(bookings)
    .values({
      carWashId,
      customerId: customer.id,
      vehicleId: vehicle.id,
      serviceId: service.id,
      bookingDate: new Date().toISOString().slice(0, 10),
      startTime: '10:00',
      endTime: '10:20',
      status: 'CONFIRMED',
      createdBy: userId,
    })
    .returning();
  const res = await request(app)
    .post('/api/v1/orders')
    .set(...bearer(token))
    .send({ bookingId: booking.id });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; status: string };
}

const patch = (token: string, id: string, status: string) =>
  request(app)
    .patch(`/api/v1/orders/${id}`)
    .set(...bearer(token))
    .send({ status });

describe('Order workflow: Waiting -> Washing -> Ready -> Completed', () => {
  it('moves through the four states in order', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const order = await newOrder(accessToken);
    expect(order.status).toBe('CREATED');

    for (const status of ['WASHING', 'READY', 'COMPLETED']) {
      const res = await patch(accessToken, order.id, status);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(status);
    }
  });

  it('does not skip steps', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const order = await newOrder(accessToken);
    expect((await patch(accessToken, order.id, 'READY')).status).toBe(400);
    expect((await patch(accessToken, order.id, 'COMPLETED')).status).toBe(400);
  });

  it('treats CHECKED_IN from older app builds as starting the wash', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const order = await newOrder(accessToken);
    const res = await patch(accessToken, order.id, 'CHECKED_IN');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('WASHING');
  });

  it('no longer lists or filters by CHECKED_IN', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const res = await request(app)
      .get('/api/v1/orders?status=CHECKED_IN')
      .set(...bearer(accessToken));
    expect(res.status).toBe(400);
  });

  it('can still be cancelled while waiting', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const order = await newOrder(accessToken);
    const res = await patch(accessToken, order.id, 'CANCELLED');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });
});
