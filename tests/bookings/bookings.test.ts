import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { loginAs, bearer } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

async function fetchOwnerFixtures(accessToken: string) {
  const servicesRes = await request(app)
    .get('/api/v1/services')
    .set(...bearer(accessToken));
  const customersRes = await request(app)
    .get('/api/v1/customers')
    .set(...bearer(accessToken));
  const service = servicesRes.body.data.find((s: any) => s.status === 'ACTIVE');
  const customer = customersRes.body.data[0];
  const vehiclesRes = await request(app)
    .get(`/api/v1/vehicles?customerId=${customer.id}`)
    .set(...bearer(accessToken));
  const vehicle = vehiclesRes.body.data[0];
  return { service, customer, vehicle };
}

describe('Bookings', () => {
  it('creates a booking with a derived endTime and rejects an overlapping booking', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const { service, customer, vehicle } = await fetchOwnerFixtures(accessToken);

    const createRes = await request(app)
      .post('/api/v1/bookings')
      .set(...bearer(accessToken))
      .send({
        customerId: customer.id,
        vehicleId: vehicle.id,
        serviceId: service.id,
        bookingDate: '2026-11-15',
        startTime: '09:00',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('PENDING');
    expect(createRes.body.data.endTime).toBeTruthy();

    const conflictRes = await request(app)
      .post('/api/v1/bookings')
      .set(...bearer(accessToken))
      .send({
        customerId: customer.id,
        vehicleId: vehicle.id,
        serviceId: service.id,
        bookingDate: '2026-11-15',
        startTime: '09:05',
      });
    expect(conflictRes.status).toBe(409);
  });

  it('rejects a booking referencing a non-existent service', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const { customer, vehicle } = await fetchOwnerFixtures(accessToken);

    const res = await request(app)
      .post('/api/v1/bookings')
      .set(...bearer(accessToken))
      .send({
        customerId: customer.id,
        vehicleId: vehicle.id,
        serviceId: '00000000-0000-0000-0000-000000000000',
        bookingDate: '2026-11-16',
        startTime: '09:00',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a booking with a vehicle that does not belong to the given customer', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const { service, customer } = await fetchOwnerFixtures(accessToken);
    const customersRes = await request(app)
      .get('/api/v1/customers')
      .set(...bearer(accessToken));
    const otherCustomer = customersRes.body.data.find((c: any) => c.id !== customer.id);
    const otherVehiclesRes = await request(app)
      .get(`/api/v1/vehicles?customerId=${otherCustomer.id}`)
      .set(...bearer(accessToken));
    const otherVehicle = otherVehiclesRes.body.data[0];

    const res = await request(app)
      .post('/api/v1/bookings')
      .set(...bearer(accessToken))
      .send({
        customerId: customer.id,
        vehicleId: otherVehicle.id,
        serviceId: service.id,
        bookingDate: '2026-11-17',
        startTime: '09:00',
      });
    expect(res.status).toBe(400);
  });

  it('updates a PENDING booking, then cancels it', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const { service, customer, vehicle } = await fetchOwnerFixtures(accessToken);

    const createRes = await request(app)
      .post('/api/v1/bookings')
      .set(...bearer(accessToken))
      .send({
        customerId: customer.id,
        vehicleId: vehicle.id,
        serviceId: service.id,
        bookingDate: '2026-11-18',
        startTime: '10:00',
      });
    const bookingId = createRes.body.data.id;

    const updateRes = await request(app)
      .patch(`/api/v1/bookings/${bookingId}`)
      .set(...bearer(accessToken))
      .send({ notes: 'Please use eco-friendly soap' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.notes).toBe('Please use eco-friendly soap');

    const cancelRes = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set(...bearer(accessToken))
      .send({});
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('CANCELLED');

    // A cancelled booking can no longer be modified.
    const updateAfterCancel = await request(app)
      .patch(`/api/v1/bookings/${bookingId}`)
      .set(...bearer(accessToken))
      .send({ notes: 'too late' });
    expect(updateAfterCancel.status).toBe(400);
  });

  it('rejects an invalid status transition (cancel then cancel again)', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const { service, customer, vehicle } = await fetchOwnerFixtures(accessToken);

    const createRes = await request(app)
      .post('/api/v1/bookings')
      .set(...bearer(accessToken))
      .send({
        customerId: customer.id,
        vehicleId: vehicle.id,
        serviceId: service.id,
        bookingDate: '2026-11-19',
        startTime: '11:00',
      });
    const bookingId = createRes.body.data.id;

    await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set(...bearer(accessToken))
      .send({});

    const secondCancel = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set(...bearer(accessToken))
      .send({});
    expect(secondCancel.status).toBe(400);
  });
});
