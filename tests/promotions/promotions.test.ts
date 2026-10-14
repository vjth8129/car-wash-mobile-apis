import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { personalize, runDuePromotions } from '../../src/services/promotion.service';
import { loginAs, bearer, uniquePhone } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

const ownerToken = async () => (await loginAs(app, 'owner', 'Owner@123')).accessToken;
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

async function newCustomer(token: string, name = 'Promo Tester') {
  const res = await request(app)
    .post('/api/v1/customers')
    .set(...bearer(token))
    .send({ name, phone: uniquePhone() });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; name: string };
}

/** A customer with one completed wash of a fresh service today. */
async function washedCustomer(token: string) {
  const service = await request(app)
    .post('/api/v1/services')
    .set(...bearer(token))
    .send({ name: `Promo Wash ${Date.now()}-${Math.random()}`, durationMinutes: 20, price: 250 });
  const customer = await newCustomer(token, 'Anu Varghese');
  const vehicle = await request(app)
    .post('/api/v1/vehicles')
    .set(...bearer(token))
    .send({
      customerId: customer.id,
      registrationNumber: `KL07PR${Math.floor(Math.random() * 9000 + 1000)}${Date.now() % 100}`,
    });
  const booking = await request(app)
    .post('/api/v1/bookings')
    .set(...bearer(token))
    .send({
      customerId: customer.id,
      vehicleId: vehicle.body.data.id,
      serviceIds: [service.body.data.id],
      bookingDate: '2027-09-01',
      startTime: '09:00',
    });
  const order = await request(app)
    .post('/api/v1/orders')
    .set(...bearer(token))
    .send({ bookingId: booking.body.data.id });
  for (const status of ['WASHING', 'READY', 'COMPLETED']) {
    await request(app)
      .patch(`/api/v1/orders/${order.body.data.id}`)
      .set(...bearer(token))
      .send({ status });
  }
  return { customer, serviceId: service.body.data.id as string };
}

const create = (token: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/v1/promotions')
    .set(...bearer(token))
    .send({ title: 'Diwali offer', message: 'Hi {name}, 10% off this week!', ...body });

describe('GET /reports/customers (promotion audience)', () => {
  it('lists the customers behind the matching washes', async () => {
    const token = await ownerToken();
    const { customer, serviceId } = await washedCustomer(token);
    const day = today();

    const res = await request(app)
      .get('/api/v1/reports/customers')
      .query({ from: day, to: day, serviceId })
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.customers).toEqual([
      expect.objectContaining({ id: customer.id, visits: 1, spent: 250, returned: false }),
    ]);
    expect(res.body.data.customers[0].services).toHaveLength(1);

    const regulars = await request(app)
      .get('/api/v1/reports/customers')
      .query({ from: day, to: day, serviceId, minVisits: '2' })
      .set(...bearer(token));
    expect(regulars.body.data.customers).toEqual([]);
  });
});

describe('Promotions', () => {
  it('sends a "send now" promotion to every customer and records each delivery', async () => {
    const token = await ownerToken();
    const a = await newCustomer(token, 'Rahul Nair');
    const b = await newCustomer(token);

    const res = await create(token, {
      customerIds: [a.id, b.id],
      channel: 'SMS',
      audienceLabel: 'Basic Wash · last 7 days',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'SCHEDULED', recipientCount: 2, channel: 'SMS' });

    await runDuePromotions();

    const sent = await request(app)
      .get(`/api/v1/promotions/${res.body.data.id}`)
      .set(...bearer(token));
    expect(sent.body.data).toMatchObject({
      status: 'SENT',
      sentCount: 2,
      failedCount: 0,
      deliveryMode: 'console',
      audienceLabel: 'Basic Wash · last 7 days',
    });
    expect(sent.body.data.recipients.map((r: any) => r.status)).toEqual(['SENT', 'SENT']);

    const list = await request(app)
      .get('/api/v1/promotions')
      .set(...bearer(token));
    expect(list.body.data[0]).toMatchObject({ id: res.body.data.id, status: 'SENT' });
  });

  it('keeps a scheduled promotion until its time, and lets it be cancelled before then', async () => {
    const token = await ownerToken();
    const a = await newCustomer(token);
    const sendAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const res = await create(token, { customerIds: [a.id], sendAt });
    expect(res.status).toBe(201);
    const id = res.body.data.id;

    await runDuePromotions();
    const still = await request(app)
      .get(`/api/v1/promotions/${id}`)
      .set(...bearer(token));
    expect(still.body.data).toMatchObject({ status: 'SCHEDULED', sentCount: 0 });

    const cancel = () =>
      request(app)
        .post(`/api/v1/promotions/${id}/cancel`)
        .set(...bearer(token));
    expect((await cancel()).body.data.status).toBe('CANCELLED');
    expect((await cancel()).status).toBe(409);
  });

  it('rejects a time in the past and customers from another car wash', async () => {
    const token = await ownerToken();
    const a = await newCustomer(token);
    const past = await create(token, {
      customerIds: [a.id],
      sendAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(past.status).toBe(400);

    const ownerB = (await loginAs(app, 'owner_b', 'OwnerB@123')).accessToken;
    const foreign = await create(ownerB, { customerIds: [a.id] });
    expect(foreign.status).toBe(400);
  });

  it("does not show one car wash's promotions to another", async () => {
    const token = await ownerToken();
    const a = await newCustomer(token);
    const res = await create(token, { customerIds: [a.id] });
    const ownerB = (await loginAs(app, 'owner_b', 'OwnerB@123')).accessToken;
    const peek = await request(app)
      .get(`/api/v1/promotions/${res.body.data.id}`)
      .set(...bearer(ownerB));
    expect(peek.status).toBe(404);
  });

  it('fills in each first name', () => {
    expect(personalize('Hi {name}!', 'Rahul Nair')).toBe('Hi Rahul!');
    expect(personalize('Hi {name}!', '  ')).toBe('Hi there!');
  });
});
