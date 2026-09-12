import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { loginAs, bearer } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe('Authorization: unauthenticated access', () => {
  it('rejects a protected route with no Authorization header', async () => {
    const res = await request(app).get('/api/v1/services');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a request with a garbage token', async () => {
    const res = await request(app)
      .get('/api/v1/services')
      .set(...bearer('not-a-real-token'));
    expect(res.status).toBe(401);
  });
});

describe('Authorization: permission-based access', () => {
  it('grants access when the role holds the required permission (manager can view services)', async () => {
    const { accessToken } = await loginAs(app, 'manager', 'Manager@123');
    const res = await request(app)
      .get('/api/v1/services')
      .set(...bearer(accessToken));
    expect(res.status).toBe(200);
  });

  it('denies access when the role lacks the required permission (staff cannot create services)', async () => {
    const { accessToken } = await loginAs(app, 'staff', 'Staff@123');
    const res = await request(app)
      .post('/api/v1/services')
      .set(...bearer(accessToken))
      .send({ name: 'Unauthorized Service', price: 100, durationMinutes: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('denies staff from viewing users (no USERS_VIEW permission)', async () => {
    const { accessToken } = await loginAs(app, 'staff', 'Staff@123');
    const res = await request(app)
      .get('/api/v1/users')
      .set(...bearer(accessToken));
    expect(res.status).toBe(403);
  });

  it('allows owner (who holds USERS_VIEW) to list users', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const res = await request(app)
      .get('/api/v1/users')
      .set(...bearer(accessToken));
    expect(res.status).toBe(200);
  });
});

describe('Authorization: role-based access', () => {
  it('denies a non-SUPER_ADMIN role from listing the global car wash directory', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const res = await request(app)
      .get('/api/v1/car-washes')
      .set(...bearer(accessToken));
    expect(res.status).toBe(403);
  });

  it('allows SUPER_ADMIN to list the global car wash directory', async () => {
    const { accessToken } = await loginAs(app, 'superadmin', 'SuperAdmin@123');
    const res = await request(app)
      .get('/api/v1/car-washes')
      .set(...bearer(accessToken));
    expect(res.status).toBe(200);
  });

  it('denies a non-SUPER_ADMIN from viewing platform-wide reports', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const res = await request(app)
      .get('/api/v1/reports/platform')
      .set(...bearer(accessToken));
    expect(res.status).toBe(403);
  });
});

describe('Dynamic menu reflects resolved permissions', () => {
  it('includes the Users menu item for owner but not for staff', async () => {
    const ownerLogin = await loginAs(app, 'owner', 'Owner@123');
    const staffLogin = await loginAs(app, 'staff', 'Staff@123');

    const ownerMenu = await request(app)
      .get('/api/v1/app/menu')
      .set(...bearer(ownerLogin.accessToken));
    const staffMenu = await request(app)
      .get('/api/v1/app/menu')
      .set(...bearer(staffLogin.accessToken));

    const findKey = (menus: any[], key: string): any =>
      menus.find((m) => m.key === key) ??
      menus.flatMap((m) => findKey(m.children, key)).find(Boolean);

    const managementForOwner = findKey(ownerMenu.body.data.menus, 'users');
    const managementForStaff = findKey(staffMenu.body.data.menus, 'users');

    expect(managementForOwner).toBeDefined();
    expect(managementForStaff).toBeUndefined();
  });
});
