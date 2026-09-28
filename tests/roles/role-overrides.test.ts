import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import { loginAs, bearer } from '../helpers/auth';

const app = createApp();

async function ownerToken() {
  return (await loginAs(app, 'owner', 'Owner@123')).accessToken;
}

async function roleByName(token: string, name: string) {
  const res = await request(app)
    .get('/api/v1/roles')
    .set(...bearer(token));
  return res.body.data.find((r: any) => r.name === name);
}

async function permissionId(token: string, key: string): Promise<string> {
  const res = await request(app)
    .get('/api/v1/permissions')
    .set(...bearer(token));
  return res.body.data.find((p: any) => p.key === key).id;
}

afterAll(async () => {
  // Other suites rely on the seeded STAFF permissions.
  const token = await ownerToken();
  const staff = await roleByName(token, 'STAFF');
  await request(app)
    .post(`/api/v1/roles/${staff.id}/reset`)
    .set(...bearer(token));
  await pool.end();
});

describe('Customising built-in roles per car wash', () => {
  it('removes a permission from STAFF for this car wash only, and it takes effect immediately', async () => {
    const token = await ownerToken();
    const staff = await roleByName(token, 'STAFF');
    const ordersUpdate = await permissionId(token, 'ORDERS_UPDATE');
    expect(staff.permissions.map((p: any) => p.key)).toContain('ORDERS_UPDATE');

    const res = await request(app)
      .patch(`/api/v1/roles/${staff.id}`)
      .set(...bearer(token))
      .send({
        permissionIds: staff.permissions
          .map((p: any) => p.id)
          .filter((id: string) => id !== ordersUpdate),
      });
    expect(res.status).toBe(200);
    expect(res.body.data.isCustomized).toBe(true);
    expect(res.body.data.permissions.map((p: any) => p.key)).not.toContain('ORDERS_UPDATE');

    // The staff user's resolved permissions reflect it straight away.
    const staffLogin = await loginAs(app, 'staff', 'Staff@123');
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(...bearer(staffLogin.accessToken));
    expect(me.body.data.permissions).not.toContain('ORDERS_UPDATE');
    expect(me.body.data.permissions).toContain('ORDERS_VIEW');

    // ...and it's enforced.
    const patchOrder = await request(app)
      .patch('/api/v1/orders/00000000-0000-0000-0000-000000000000')
      .set(...bearer(staffLogin.accessToken))
      .send({ status: 'CHECKED_IN' });
    expect(patchOrder.status).toBe(403);

    // Another car wash still sees the default STAFF permissions.
    const ownerB = await loginAs(app, 'owner_b', 'OwnerB@123');
    const staffForB = await roleByName(ownerB.accessToken, 'STAFF');
    expect(staffForB.isCustomized).toBe(false);
    expect(staffForB.permissions.map((p: any) => p.key)).toContain('ORDERS_UPDATE');
  });

  it('adds a permission the owner holds and resets back to the defaults', async () => {
    const token = await ownerToken();
    const staff = await roleByName(token, 'STAFF');
    const reportsView = await permissionId(token, 'REPORTS_VIEW');

    const added = await request(app)
      .patch(`/api/v1/roles/${staff.id}`)
      .set(...bearer(token))
      .send({ permissionIds: [...staff.permissions.map((p: any) => p.id), reportsView] });
    expect(added.status).toBe(200);
    expect(added.body.data.permissions.map((p: any) => p.key)).toContain('REPORTS_VIEW');

    const reset = await request(app)
      .post(`/api/v1/roles/${staff.id}/reset`)
      .set(...bearer(token));
    expect(reset.status).toBe(200);
    expect(reset.body.data.isCustomized).toBe(false);
    expect(reset.body.data.permissions.map((p: any) => p.key)).not.toContain('REPORTS_VIEW');
    expect(reset.body.data.permissions.map((p: any) => p.key)).toContain('ORDERS_UPDATE');
  });

  it("refuses to grant a permission the caller doesn't hold", async () => {
    const token = await ownerToken();
    const staff = await roleByName(token, 'STAFF');
    const platformOnly = await permissionId(token, 'CAR_WASH_CREATE');

    const res = await request(app)
      .patch(`/api/v1/roles/${staff.id}`)
      .set(...bearer(token))
      .send({ permissionIds: [...staff.permissions.map((p: any) => p.id), platformOnly] });
    expect(res.status).toBe(403);
  });

  it('refuses to change your own role, SUPER_ADMIN, or rename a built-in role', async () => {
    const token = await ownerToken();
    const owner = await roleByName(token, 'OWNER');
    const superAdmin = await roleByName(token, 'SUPER_ADMIN');
    const staff = await roleByName(token, 'STAFF');

    const own = await request(app)
      .patch(`/api/v1/roles/${owner.id}`)
      .set(...bearer(token))
      .send({ permissionIds: [] });
    expect(own.status).toBe(403);

    const sa = await request(app)
      .patch(`/api/v1/roles/${superAdmin.id}`)
      .set(...bearer(token))
      .send({ permissionIds: [] });
    expect(sa.status).toBe(403);

    const rename = await request(app)
      .patch(`/api/v1/roles/${staff.id}`)
      .set(...bearer(token))
      .send({ name: 'Washer' });
    expect(rename.status).toBe(400);
  });

  it('checks role assignment against the customised permissions', async () => {
    const token = await ownerToken();
    const staff = await roleByName(token, 'STAFF');
    // Removing permissions from STAFF keeps it assignable (subset of the owner's).
    await request(app)
      .patch(`/api/v1/roles/${staff.id}`)
      .set(...bearer(token))
      .send({ permissionIds: staff.permissions.slice(0, 2).map((p: any) => p.id) });

    const res = await request(app)
      .post('/api/v1/users')
      .set(...bearer(token))
      .send({
        username: `assign-${Date.now()}`,
        password: 'Assign@1234',
        name: 'Assign Test',
        roleId: staff.id,
      });
    expect(res.status).toBe(201);

    await request(app)
      .post(`/api/v1/roles/${staff.id}/reset`)
      .set(...bearer(token));
  });
});
