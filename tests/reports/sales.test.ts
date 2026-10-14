import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { loginAs, bearer, uniquePhone } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

const ownerToken = async () => (await loginAs(app, 'owner', 'Owner@123')).accessToken;

/** Today in the seeded car wash's timezone, which is the day a wash completed now counts on. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const sales = (token: string, query: Record<string, string>) =>
  request(app)
    .get('/api/v1/reports/sales')
    .query(query)
    .set(...bearer(token));

async function createService(token: string, price: number) {
  const res = await request(app)
    .post('/api/v1/services')
    .set(...bearer(token))
    .send({ name: `Sales Test ${Date.now()}-${Math.random()}`, durationMinutes: 20, price });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; name: string };
}

/** Books both services on one car, takes the wash through to Completed and notes a UPI payment. */
async function completedWash(token: string, serviceIds: string[]) {
  const customer = await request(app)
    .post('/api/v1/customers')
    .set(...bearer(token))
    .send({ name: 'Sales Tester', phone: uniquePhone() });
  const vehicle = await request(app)
    .post('/api/v1/vehicles')
    .set(...bearer(token))
    .send({
      customerId: customer.body.data.id,
      registrationNumber: `KL07ST${Math.floor(Math.random() * 9000 + 1000)}${Date.now() % 100}`,
      vehicleType: 'SUV',
    });
  const booking = await request(app)
    .post('/api/v1/bookings')
    .set(...bearer(token))
    .send({
      customerId: customer.body.data.id,
      vehicleId: vehicle.body.data.id,
      serviceIds,
      bookingDate: '2027-08-01',
      startTime: '09:00',
    });
  expect(booking.status).toBe(201);
  const order = await request(app)
    .post('/api/v1/orders')
    .set(...bearer(token))
    .send({ bookingId: booking.body.data.id });
  const orderId = order.body.data.id as string;
  for (const status of ['WASHING', 'READY', 'COMPLETED']) {
    await request(app)
      .patch(`/api/v1/orders/${orderId}`)
      .set(...bearer(token))
      .send({ status });
  }
  await request(app)
    .put(`/api/v1/orders/${orderId}/payment`)
    .set(...bearer(token))
    .send({ method: 'UPI' });
  return orderId;
}

describe('GET /reports/sales', () => {
  it('counts a completed wash on the day it was handed over, split by service', async () => {
    const token = await ownerToken();
    const a = await createService(token, 199);
    const b = await createService(token, 301);
    const orderId = await completedWash(token, [a.id, b.id]);
    const day = today();

    const res = await sales(token, { from: day, to: day });
    expect(res.status).toBe(200);
    const report = res.body.data;
    expect(report.groupBy).toBe('hour');
    expect(report.previous).toMatchObject({ from: expect.any(String), to: expect.any(String) });

    const tx = report.transactions.find((t: any) => t.id === orderId);
    expect(tx).toMatchObject({ amount: 500, paymentMethod: 'UPI', vehicleType: 'SUV' });
    expect(tx.services.map((s: any) => s.price).sort()).toEqual([199, 301]);

    const byService = Object.fromEntries(report.byService.map((r: any) => [r.key, r]));
    expect(byService[a.id]).toMatchObject({ washes: 1, revenue: 199 });
    expect(byService[b.id]).toMatchObject({ washes: 1, revenue: 301 });
    expect(report.options.services.map((s: any) => s.id)).toEqual(
      expect.arrayContaining([a.id, b.id]),
    );
  });

  it('with a service filter, counts only what was charged for that service', async () => {
    const token = await ownerToken();
    const a = await createService(token, 150);
    const b = await createService(token, 250);
    await completedWash(token, [a.id, b.id]);
    const day = today();

    const res = await sales(token, { from: day, to: day, serviceId: a.id });
    expect(res.body.data.totals).toMatchObject({
      washes: 1,
      revenue: 150,
      collected: 150,
      unpaid: 0,
    });
    expect(res.body.data.byService).toEqual([
      expect.objectContaining({ key: a.id, washes: 1, revenue: 150 }),
    ]);

    const unpaid = await sales(token, {
      from: day,
      to: day,
      serviceId: a.id,
      paymentStatus: 'UNPAID',
    });
    expect(unpaid.body.data.totals.washes).toBe(0);
  });

  it('fills every day of the range so quiet days chart as zero', async () => {
    const token = await ownerToken();
    const res = await sales(token, { from: '2027-02-01', to: '2027-02-28', limit: '0' });
    expect(res.status).toBe(200);
    expect(res.body.data.groupBy).toBe('day');
    expect(res.body.data.series).toHaveLength(28);
    expect(res.body.data.series[0]).toMatchObject({ key: '2027-02-01', washes: 0, revenue: 0 });

    const months = await sales(token, { from: '2027-01-15', to: '2027-06-10', groupBy: 'month' });
    expect(months.body.data.series.map((r: any) => r.key)).toEqual([
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
    ]);
  });

  it('compares with the period just before: the previous month for a whole month', async () => {
    const token = await ownerToken();
    const week = await sales(token, { from: '2027-03-08', to: '2027-03-14', limit: '0' });
    expect(week.body.data.previous).toMatchObject({ from: '2027-03-01', to: '2027-03-07' });
    const month = await sales(token, { from: '2027-03-01', to: '2027-03-31', limit: '0' });
    expect(month.body.data.previous).toMatchObject({ from: '2027-02-01', to: '2027-02-28' });
  });

  it('rejects a backwards or over-long range', async () => {
    const token = await ownerToken();
    expect((await sales(token, { from: '2027-03-02', to: '2027-03-01' })).status).toBe(400);
    expect((await sales(token, { from: '2025-01-01', to: '2027-01-01' })).status).toBe(400);
    expect((await sales(token, { from: 'yesterday', to: '2027-01-01' })).status).toBe(400);
  });
});

describe('Sales report export (PDF / Excel)', () => {
  const download = (path: string) =>
    request(app)
      .get(`/api/v1${path}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

  it.each([
    ['pdf', 'application/pdf', '%PDF'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'PK'],
  ])('makes a download link for a %s file', async (format, type, magic) => {
    const token = await ownerToken();
    const link = await request(app)
      .post('/api/v1/reports/sales/export-link')
      .set(...bearer(token))
      .send({ format, from: '2027-02-01', to: '2027-02-28' });
    expect(link.status).toBe(201);
    expect(link.body.data.filename).toBe(`sales-report_2027-02-01_to_2027-02-28.${format}`);

    const file = await download(link.body.data.path);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe(type);
    expect(file.headers['content-disposition']).toContain(link.body.data.filename);
    expect((file.body as Buffer).subarray(0, magic.length).toString()).toBe(magic);
  });

  it('refuses a link with a bad token, and an export of a backwards range', async () => {
    const res = await request(app).get('/api/v1/reports/sales/export?token=not-a-token');
    expect(res.status).toBe(401);

    const token = await ownerToken();
    const bad = await request(app)
      .post('/api/v1/reports/sales/export-link')
      .set(...bearer(token))
      .send({ format: 'pdf', from: '2027-03-02', to: '2027-03-01' });
    expect(bad.status).toBe(400);
  });
});
