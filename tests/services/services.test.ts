import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { loginAs, bearer } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe('Services CRUD', () => {
  it('creates, reads, updates, and deletes a service', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');

    const createRes = await request(app)
      .post('/api/v1/services')
      .set(...bearer(accessToken))
      .send({ name: `Wax Coating ${Date.now()}`, price: 599, durationMinutes: 30 });
    expect(createRes.status).toBe(201);
    const serviceId = createRes.body.data.id;
    expect(createRes.body.data.status).toBe('ACTIVE');

    const getRes = await request(app)
      .get(`/api/v1/services/${serviceId}`)
      .set(...bearer(accessToken));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.price).toBe('599.00');

    const updateRes = await request(app)
      .patch(`/api/v1/services/${serviceId}`)
      .set(...bearer(accessToken))
      .send({ price: 649, status: 'INACTIVE' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.price).toBe('649.00');
    expect(updateRes.body.data.status).toBe('INACTIVE');

    const deleteRes = await request(app)
      .delete(`/api/v1/services/${serviceId}`)
      .set(...bearer(accessToken));
    expect(deleteRes.status).toBe(200);

    const getAfterDelete = await request(app)
      .get(`/api/v1/services/${serviceId}`)
      .set(...bearer(accessToken));
    expect(getAfterDelete.status).toBe(404);
  });

  it('rejects invalid payloads (negative price)', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const res = await request(app)
      .post('/api/v1/services')
      .set(...bearer(accessToken))
      .send({ name: 'Invalid Service', price: -10, durationMinutes: 30 });
    expect(res.status).toBe(400);
  });

  it('rejects creating a duplicate service name within the same car wash', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const name = `Duplicate Service ${Date.now()}`;
    const first = await request(app)
      .post('/api/v1/services')
      .set(...bearer(accessToken))
      .send({ name, price: 100, durationMinutes: 10 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/services')
      .set(...bearer(accessToken))
      .send({ name, price: 100, durationMinutes: 10 });
    expect(second.status).toBe(409);
  });

  it('supports pagination', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const res = await request(app)
      .get('/api/v1/services?page=1&limit=2')
      .set(...bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2 });
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });
});
