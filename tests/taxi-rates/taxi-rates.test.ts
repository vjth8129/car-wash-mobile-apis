import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { loginAs, bearer } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

async function ownerToken() {
  return (await loginAs(app, 'owner', 'Owner@123')).accessToken;
}

async function createService(token: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post('/api/v1/services')
    .set(...bearer(token))
    .send({ name: `Taxi Test ${Date.now()}-${Math.random()}`, durationMinutes: 20, ...body });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function ownerVehicle(token: string) {
  const customers = await request(app)
    .get('/api/v1/customers')
    .set(...bearer(token));
  const customer = customers.body.data[0];
  const vehicles = await request(app)
    .get(`/api/v1/vehicles?customerId=${customer.id}`)
    .set(...bearer(token));
  return { customer, vehicle: vehicles.body.data[0] };
}

// Each booking gets its own slot so the per-vehicle overlap check never interferes.
let slot = 0;
async function book(token: string, serviceId: string, vehicleCategory?: 'PRIVATE' | 'TAXI') {
  const { customer, vehicle } = await ownerVehicle(token);
  slot += 1;
  const res = await request(app)
    .post('/api/v1/bookings')
    .set(...bearer(token))
    .send({
      customerId: customer.id,
      vehicleId: vehicle.id,
      serviceId,
      bookingDate: `2027-03-${String(slot).padStart(2, '0')}`,
      startTime: '10:00',
      ...(vehicleCategory ? { vehicleCategory } : {}),
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('Service taxi rates', () => {
  it('stores, returns and clears taxiPrice', async () => {
    const token = await ownerToken();
    const service = await createService(token, { price: 400, taxiPrice: 350 });
    expect(service.price).toBe('400.00');
    expect(service.taxiPrice).toBe('350.00');

    const cleared = await request(app)
      .patch(`/api/v1/services/${service.id}`)
      .set(...bearer(token))
      .send({ taxiPrice: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.taxiPrice).toBeNull();
  });

  it('always includes the taxiPrice key on listed services (clients detect support by it)', async () => {
    const token = await ownerToken();
    const res = await request(app)
      .get('/api/v1/services')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    for (const s of res.body.data) expect(s).toHaveProperty('taxiPrice');
  });

  it('rejects a non-positive taxiPrice', async () => {
    const token = await ownerToken();
    const res = await request(app)
      .post('/api/v1/services')
      .set(...bearer(token))
      .send({ name: `Bad Taxi ${Date.now()}`, price: 100, taxiPrice: -5, durationMinutes: 20 });
    expect(res.status).toBe(400);
  });

  it('deactivates and reactivates a service via PATCH status', async () => {
    const token = await ownerToken();
    const service = await createService(token, { price: 250 });

    const off = await request(app)
      .patch(`/api/v1/services/${service.id}`)
      .set(...bearer(token))
      .send({ status: 'INACTIVE' });
    expect(off.body.data.status).toBe('INACTIVE');

    const inactiveList = await request(app)
      .get('/api/v1/services?status=INACTIVE&limit=100')
      .set(...bearer(token));
    expect(inactiveList.body.data.map((s: any) => s.id)).toContain(service.id);

    const on = await request(app)
      .patch(`/api/v1/services/${service.id}`)
      .set(...bearer(token))
      .send({ status: 'ACTIVE' });
    expect(on.body.data.status).toBe('ACTIVE');
  });
});

describe('Booking price snapshot', () => {
  it('charges the taxi rate for TAXI bookings and the regular rate otherwise', async () => {
    const token = await ownerToken();
    const service = await createService(token, { price: 400, taxiPrice: 350 });

    const privateBooking = await book(token, service.id);
    expect(privateBooking.vehicleCategory).toBe('PRIVATE');
    expect(privateBooking.price).toBe('400.00');

    const taxiBooking = await book(token, service.id, 'TAXI');
    expect(taxiBooking.vehicleCategory).toBe('TAXI');
    expect(taxiBooking.price).toBe('350.00');
    // Nested relation numerics are returned as numbers (same as the existing nested service.price).
    expect(Number(taxiBooking.service.taxiPrice)).toBe(350);
  });

  it('falls back to the regular price for taxis when no taxi rate is set', async () => {
    const token = await ownerToken();
    const service = await createService(token, { price: 300 });
    const booking = await book(token, service.id, 'TAXI');
    expect(booking.price).toBe('300.00');
  });

  it('keeps the original price when the service rates change later', async () => {
    const token = await ownerToken();
    const service = await createService(token, { price: 500, taxiPrice: 450 });
    const booking = await book(token, service.id, 'TAXI');

    await request(app)
      .patch(`/api/v1/services/${service.id}`)
      .set(...bearer(token))
      .send({ price: 900, taxiPrice: 800 });

    const reloaded = await request(app)
      .get(`/api/v1/bookings/${booking.id}`)
      .set(...bearer(token));
    expect(reloaded.body.data.price).toBe('450.00');
  });

  it('re-prices when the booking category changes', async () => {
    const token = await ownerToken();
    const service = await createService(token, { price: 600, taxiPrice: 500 });
    const booking = await book(token, service.id);
    expect(booking.price).toBe('600.00');

    const res = await request(app)
      .patch(`/api/v1/bookings/${booking.id}`)
      .set(...bearer(token))
      .send({ vehicleCategory: 'TAXI' });
    expect(res.status).toBe(200);
    expect(res.body.data.vehicleCategory).toBe('TAXI');
    expect(res.body.data.price).toBe('500.00');
  });

  it('bills the completed order at the booking price and nests category/price in orders', async () => {
    const token = await ownerToken();
    const service = await createService(token, { price: 700, taxiPrice: 550 });
    const booking = await book(token, service.id, 'TAXI');

    const orderRes = await request(app)
      .post('/api/v1/orders')
      .set(...bearer(token))
      .send({ bookingId: booking.id });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.data.id;
    expect(orderRes.body.data.booking.vehicleCategory).toBe('TAXI');
    expect(Number(orderRes.body.data.booking.price)).toBe(550);

    for (const status of ['WASHING', 'READY', 'COMPLETED']) {
      const step = await request(app)
        .patch(`/api/v1/orders/${orderId}`)
        .set(...bearer(token))
        .send({ status });
      expect(step.status).toBe(200);
    }

    const done = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set(...bearer(token));
    expect(done.body.data.totalAmount).toBe('550.00');

    const list = await request(app)
      .get('/api/v1/orders?limit=100')
      .set(...bearer(token));
    const listed = list.body.data.find((o: any) => o.id === orderId);
    expect(listed.booking.vehicleCategory).toBe('TAXI');
    expect(Number(listed.booking.price)).toBe(550);
  });
});

describe('Rate limiting', () => {
  it('limits authenticated requests per user and anonymous requests per IP', async () => {
    const token = await ownerToken();
    const authed = await request(app)
      .get('/api/v1/services')
      .set(...bearer(token));
    expect(authed.headers['ratelimit-limit']).toBe('20000'); // RATE_LIMIT_USER_MAX in .env.test

    const anon = await request(app).get('/api/v1/app/config');
    expect(anon.headers['ratelimit-limit']).toBe('10000'); // RATE_LIMIT_MAX in .env.test

    const badToken = await request(app)
      .get('/api/v1/app/config')
      .set(...bearer('not-a-jwt'));
    expect(badToken.headers['ratelimit-limit']).toBe('10000');
  });
});
