import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { bearer, loginAs } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

// A 1x1 PNG is enough to exercise the API.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Payment QR', () => {
  it('owner uploads it, staff of the same car wash see it, other car washes do not', async () => {
    const owner = await loginAs(app, 'owner', 'Owner@123');
    const put = await request(app)
      .put('/api/v1/app/payment-qr')
      .set(...bearer(owner.accessToken))
      .send({ image: PNG, note: 'sparkle@okicici' });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ image: PNG, note: 'sparkle@okicici' });

    const staff = await loginAs(app, 'staff', 'Staff@123');
    const seen = await request(app)
      .get('/api/v1/app/payment-qr')
      .set(...bearer(staff.accessToken));
    expect(seen.status).toBe(200);
    expect(seen.body.data).toMatchObject({ image: PNG, note: 'sparkle@okicici' });

    const ownerB = await loginAs(app, 'owner_b', 'OwnerB@123');
    const other = await request(app)
      .get('/api/v1/app/payment-qr')
      .set(...bearer(ownerB.accessToken));
    expect(other.status).toBe(200);
    expect(other.body.data).toBeNull();
  });

  it('only users who can update the car wash may change it', async () => {
    const staff = await loginAs(app, 'staff', 'Staff@123');
    const put = await request(app)
      .put('/api/v1/app/payment-qr')
      .set(...bearer(staff.accessToken))
      .send({ image: PNG });
    expect(put.status).toBe(403);
    const del = await request(app)
      .delete('/api/v1/app/payment-qr')
      .set(...bearer(staff.accessToken));
    expect(del.status).toBe(403);
  });

  it('rejects things that are not a reasonably sized image', async () => {
    const owner = await loginAs(app, 'owner', 'Owner@123');
    for (const image of [
      'https://example.com/qr.png',
      'data:image/svg+xml;base64,PHN2Zz4=',
      `data:image/png;base64,${'A'.repeat(760_000)}`,
    ]) {
      const res = await request(app)
        .put('/api/v1/app/payment-qr')
        .set(...bearer(owner.accessToken))
        .send({ image });
      expect(res.status).toBe(400);
    }
  });

  it('owner can remove it', async () => {
    const owner = await loginAs(app, 'owner', 'Owner@123');
    await request(app)
      .put('/api/v1/app/payment-qr')
      .set(...bearer(owner.accessToken))
      .send({ image: PNG });
    const del = await request(app)
      .delete('/api/v1/app/payment-qr')
      .set(...bearer(owner.accessToken));
    expect(del.status).toBe(200);
    const after = await request(app)
      .get('/api/v1/app/payment-qr')
      .set(...bearer(owner.accessToken));
    expect(after.body.data).toBeNull();
  });

  it('is not available to platform admins (no car wash)', async () => {
    const admin = await loginAs(app, 'superadmin', 'SuperAdmin@123');
    const res = await request(app)
      .get('/api/v1/app/payment-qr')
      .set(...bearer(admin.accessToken));
    expect(res.status).toBe(403);
  });
});
