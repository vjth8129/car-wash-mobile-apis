import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { loginAs, bearer, uniquePhone } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

const ownerToken = async () => (await loginAs(app, 'owner', 'Owner@123')).accessToken;
const adminToken = async () => (await loginAs(app, 'superadmin', 'SuperAdmin@123')).accessToken;

async function categories(token: string) {
  const res = await request(app)
    .get('/api/v1/vehicle-categories')
    .set(...bearer(token));
  expect(res.status).toBe(200);
  const byCode = (code: string) => res.body.data.find((c: any) => c.code === code);
  return { all: res.body.data, private: byCode('PRIVATE'), taxi: byCode('TAXI') };
}

async function createService(token: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post('/api/v1/services')
    .set(...bearer(token))
    .send({ name: `Cat Test ${Date.now()}-${Math.random()}`, durationMinutes: 20, ...body });
  expect(res.status).toBe(201);
  return res.body.data;
}

/** A fresh customer + vehicle so the remembered category starts clean. */
async function freshVehicle(token: string) {
  const customer = await request(app)
    .post('/api/v1/customers')
    .set(...bearer(token))
    .send({ name: 'Category Tester', phone: uniquePhone() });
  expect(customer.status).toBe(201);
  const vehicle = await request(app)
    .post('/api/v1/vehicles')
    .set(...bearer(token))
    .send({
      customerId: customer.body.data.id,
      registrationNumber: `KL07CT${Math.floor(Math.random() * 9000 + 1000)}${Date.now() % 100}`,
    });
  expect(vehicle.status).toBe(201);
  return { customer: customer.body.data, vehicle: vehicle.body.data };
}

let day = 0;
async function book(
  token: string,
  ids: { customer: any; vehicle: any },
  body: Record<string, unknown>,
) {
  day += 1;
  return request(app)
    .post('/api/v1/bookings')
    .set(...bearer(token))
    .send({
      customerId: ids.customer.id,
      vehicleId: ids.vehicle.id,
      bookingDate: `2027-05-${String(day).padStart(2, '0')}`,
      startTime: '09:00',
      ...body,
    });
}

describe('Vehicle categories (platform-managed)', () => {
  it('lists Private and Taxi to car wash users', async () => {
    const { private: priv, taxi } = await categories(await ownerToken());
    expect(priv).toMatchObject({ code: 'PRIVATE', name: 'Private', status: 'ACTIVE' });
    expect(taxi).toMatchObject({ code: 'TAXI', name: 'Taxi' });
  });

  it('only lets platform admins add and edit categories', async () => {
    const owner = await ownerToken();
    const denied = await request(app)
      .post('/api/v1/vehicle-categories')
      .set(...bearer(owner))
      .send({ name: 'Commercial' });
    expect(denied.status).toBe(403);

    const admin = await adminToken();
    const name = `Mini Bus ${Date.now() % 100000}`;
    const created = await request(app)
      .post('/api/v1/vehicle-categories')
      .set(...bearer(admin))
      .send({ name });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe(name.toUpperCase().replace(/ /g, '_'));

    const dup = await request(app)
      .post('/api/v1/vehicle-categories')
      .set(...bearer(admin))
      .send({ name });
    expect(dup.status).toBe(409);

    const off = await request(app)
      .patch(`/api/v1/vehicle-categories/${created.body.data.id}`)
      .set(...bearer(admin))
      .send({ status: 'INACTIVE' });
    expect(off.status).toBe(200);
    const { all } = await categories(owner);
    expect(all.map((c: any) => c.id)).not.toContain(created.body.data.id);

    const withInactive = await request(app)
      .get('/api/v1/vehicle-categories?includeInactive=true')
      .set(...bearer(admin));
    expect(withInactive.body.data.map((c: any) => c.id)).toContain(created.body.data.id);
  });

  it('refuses to deactivate Private (the default)', async () => {
    const admin = await adminToken();
    const { private: priv } = await categories(admin);
    const res = await request(app)
      .patch(`/api/v1/vehicle-categories/${priv.id}`)
      .set(...bearer(admin))
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(400);
  });
});

describe('Service rates per category', () => {
  it('stores rates and mirrors the Taxi rate into taxiPrice for older clients', async () => {
    const token = await ownerToken();
    const { taxi } = await categories(token);
    const service = await createService(token, {
      price: 400,
      rates: [{ categoryId: taxi.id, price: 350 }],
    });
    // Nested relation numerics come back as numbers.
    expect(service.rates.map((r: any) => [r.categoryId, Number(r.price)])).toEqual([
      [taxi.id, 350],
    ]);
    expect(service.taxiPrice).toBe('350.00');

    const cleared = await request(app)
      .patch(`/api/v1/services/${service.id}`)
      .set(...bearer(token))
      .send({ rates: [] });
    expect(cleared.body.data.rates).toEqual([]);
    expect(cleared.body.data.taxiPrice).toBeNull();
  });

  it('turns a legacy taxiPrice into a Taxi rate', async () => {
    const token = await ownerToken();
    const { taxi } = await categories(token);
    const service = await createService(token, { price: 300, taxiPrice: 250 });
    expect(service.rates.map((r: any) => [r.categoryId, Number(r.price)])).toEqual([
      [taxi.id, 250],
    ]);
  });
});

describe('Multi-service bookings', () => {
  it('charges each service at the category rate, sums the total and the duration', async () => {
    const token = await ownerToken();
    const { taxi } = await categories(token);
    const wash = await createService(token, {
      price: 400,
      durationMinutes: 30,
      rates: [{ categoryId: taxi.id, price: 300 }],
    });
    const polish = await createService(token, { price: 250, durationMinutes: 45 });
    const ids = await freshVehicle(token);

    const res = await book(token, ids, {
      serviceIds: [wash.id, polish.id],
      vehicleCategoryId: taxi.id,
    });
    expect(res.status).toBe(201);
    const b = res.body.data;
    expect(b.price).toBe('550.00');
    expect(b.serviceId).toBe(wash.id);
    expect(b.endTime.slice(0, 5)).toBe('10:15');
    expect(b.vehicleCategory).toBe('TAXI');
    expect(b.category).toMatchObject({ id: taxi.id, code: 'TAXI' });
    expect(b.items.map((i: any) => [i.serviceId, Number(i.price)])).toEqual([
      [wash.id, 300],
      [polish.id, 250],
    ]);
  });

  it('remembers the vehicle category for the next wash and updates it when switched', async () => {
    const token = await ownerToken();
    const { taxi, private: priv } = await categories(token);
    const wash = await createService(token, {
      price: 500,
      rates: [{ categoryId: taxi.id, price: 420 }],
    });
    const ids = await freshVehicle(token);
    expect(ids.vehicle.categoryId).toBe(priv.id);

    await book(token, ids, { serviceIds: [wash.id], vehicleCategoryId: taxi.id });
    const vehicle = await request(app)
      .get(`/api/v1/vehicles/${ids.vehicle.id}`)
      .set(...bearer(token));
    expect(vehicle.body.data.categoryId).toBe(taxi.id);

    // No category sent: the vehicle's (taxi) is used.
    const again = await book(token, ids, { serviceIds: [wash.id] });
    expect(again.body.data.price).toBe('420.00');

    // Switched to private: charged privately and the vehicle is updated.
    const switched = await book(token, ids, { serviceIds: [wash.id], vehicleCategoryId: priv.id });
    expect(switched.body.data.price).toBe('500.00');
    const after = await request(app)
      .get(`/api/v1/vehicles/${ids.vehicle.id}`)
      .set(...bearer(token));
    expect(after.body.data.categoryId).toBe(priv.id);
  });

  it('still accepts a single serviceId and the PRIVATE/TAXI flag (older app builds)', async () => {
    const token = await ownerToken();
    const wash = await createService(token, { price: 400, taxiPrice: 333 });
    const ids = await freshVehicle(token);
    const res = await book(token, ids, { serviceId: wash.id, vehicleCategory: 'TAXI' });
    expect(res.status).toBe(201);
    expect(res.body.data.price).toBe('333.00');
    expect(res.body.data.items).toHaveLength(1);
  });

  it('rejects a booking without services and an unknown category', async () => {
    const token = await ownerToken();
    const ids = await freshVehicle(token);
    expect((await book(token, ids, {})).status).toBe(400);
    const wash = await createService(token, { price: 100 });
    const bad = await book(token, ids, {
      serviceIds: [wash.id],
      vehicleCategoryId: '00000000-0000-4000-8000-000000000000',
    });
    expect(bad.status).toBe(400);
  });

  it('re-prices when services are changed on an open booking', async () => {
    const token = await ownerToken();
    const a = await createService(token, { price: 100 });
    const b = await createService(token, { price: 150 });
    const ids = await freshVehicle(token);
    const booking = (await book(token, ids, { serviceIds: [a.id] })).body.data;

    const res = await request(app)
      .patch(`/api/v1/bookings/${booking.id}`)
      .set(...bearer(token))
      .send({ serviceIds: [a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.price).toBe('250.00');
    expect(res.body.data.items).toHaveLength(2);
  });
});

describe('Order total and payment', () => {
  it('lets a car be booked again in the slot of a wash that was already completed', async () => {
    const token = await ownerToken();
    const a = await createService(token, { price: 120, durationMinutes: 60 });
    const ids = await freshVehicle(token);
    const body = { serviceIds: [a.id], bookingDate: '2027-06-15', startTime: '11:00' };
    const first = (await book(token, ids, body)).body.data;
    expect((await book(token, ids, body)).status).toBe(409);

    const order = await request(app)
      .post('/api/v1/orders')
      .set(...bearer(token))
      .send({ bookingId: first.id });
    for (const status of ['WASHING', 'READY', 'COMPLETED']) {
      await request(app)
        .patch(`/api/v1/orders/${order.body.data.id}`)
        .set(...bearer(token))
        .send({ status });
    }
    expect((await book(token, ids, body)).status).toBe(201);
  });

  it('bills the total of all services and records / clears the payment', async () => {
    const token = await ownerToken();
    const a = await createService(token, { price: 199 });
    const b = await createService(token, { price: 301 });
    const ids = await freshVehicle(token);
    const booking = (await book(token, ids, { serviceIds: [a.id, b.id] })).body.data;

    const order = await request(app)
      .post('/api/v1/orders')
      .set(...bearer(token))
      .send({ bookingId: booking.id });
    const orderId = order.body.data.id;
    expect(order.body.data.booking.items).toHaveLength(2);
    expect(order.body.data.paidAt).toBeNull();

    for (const status of ['WASHING', 'READY', 'COMPLETED']) {
      await request(app)
        .patch(`/api/v1/orders/${orderId}`)
        .set(...bearer(token))
        .send({ status });
    }

    const paid = await request(app)
      .put(`/api/v1/orders/${orderId}/payment`)
      .set(...bearer(token))
      .send({ method: 'UPI' });
    expect(paid.status).toBe(200);
    expect(paid.body.data.totalAmount).toBe('500.00');
    expect(paid.body.data.paymentMethod).toBe('UPI');
    expect(paid.body.data.paidAt).toBeTruthy();

    const list = await request(app)
      .get('/api/v1/orders?status=COMPLETED&limit=100')
      .set(...bearer(token));
    const listed = list.body.data.find((o: any) => o.id === orderId);
    expect(listed.paymentMethod).toBe('UPI');
    expect(listed.booking.items.map((i: any) => i.name)).toEqual([a.name, b.name]);

    const paidList = await request(app)
      .get('/api/v1/orders?status=COMPLETED&paymentStatus=PAID&limit=100')
      .set(...bearer(token));
    expect(paidList.body.data.map((o: any) => o.id)).toContain(orderId);
    const unpaidList = await request(app)
      .get('/api/v1/orders?status=COMPLETED&paymentStatus=UNPAID&limit=100')
      .set(...bearer(token));
    expect(unpaidList.body.data.map((o: any) => o.id)).not.toContain(orderId);
    expect(unpaidList.body.data.every((o: any) => o.paidAt === null)).toBe(true);

    const undone = await request(app)
      .put(`/api/v1/orders/${orderId}/payment`)
      .set(...bearer(token))
      .send({ method: null });
    expect(undone.body.data.paidAt).toBeNull();

    const bad = await request(app)
      .put(`/api/v1/orders/${orderId}/payment`)
      .set(...bearer(token))
      .send({ method: 'CARD' });
    expect(bad.status).toBe(400);
  });

  it('refuses to record a payment on a cancelled job', async () => {
    const token = await ownerToken();
    const a = await createService(token, { price: 99 });
    const ids = await freshVehicle(token);
    const booking = (await book(token, ids, { serviceIds: [a.id] })).body.data;
    const order = await request(app)
      .post('/api/v1/orders')
      .set(...bearer(token))
      .send({ bookingId: booking.id });
    await request(app)
      .patch(`/api/v1/orders/${order.body.data.id}`)
      .set(...bearer(token))
      .send({ status: 'CANCELLED' });
    const res = await request(app)
      .put(`/api/v1/orders/${order.body.data.id}/payment`)
      .set(...bearer(token))
      .send({ method: 'CASH' });
    expect(res.status).toBe(400);
  });
});
