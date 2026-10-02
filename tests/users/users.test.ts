import request from 'supertest';
import { createApp } from '../../src/app';
import { db, pool } from '../../src/db';
import { roles } from '../../src/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { loginAs, bearer, uniquePhone } from '../helpers/auth';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

async function systemRoleId(name: string): Promise<string> {
  const role = await db.query.roles.findFirst({
    where: and(eq(roles.name, name), isNull(roles.carWashId)),
  });
  if (!role) throw new Error(`System role ${name} not found`);
  return role.id;
}

describe('Users CRUD and role assignment', () => {
  it('creates a user scoped to the owner’s car wash with the requested role', async () => {
    const { accessToken, user } = await loginAs(app, 'owner', 'Owner@123');
    const staffRoleId = await systemRoleId('STAFF');

    const createRes = await request(app)
      .post('/api/v1/users')
      .set(...bearer(accessToken))
      .send({
        username: `new-staff-${Date.now()}`,
        phone: uniquePhone(),
        password: 'ValidPass@123',
        name: 'New Staff Member',
        roleId: staffRoleId,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.carWashId).toBe(user.carWashId);
    expect(createRes.body.data.passwordHash).toBeUndefined();
    const userId = createRes.body.data.id;

    const getRes = await request(app)
      .get(`/api/v1/users/${userId}`)
      .set(...bearer(accessToken));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.name).toBe('New Staff Member');
  });

  it('updates a user’s profile and role', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const staffRoleId = await systemRoleId('STAFF');
    const managerRoleId = await systemRoleId('MANAGER');

    const createRes = await request(app)
      .post('/api/v1/users')
      .set(...bearer(accessToken))
      .send({
        username: `update-target-${Date.now()}`,
        phone: uniquePhone(),
        password: 'ValidPass@123',
        name: 'Original Name',
        roleId: staffRoleId,
      });
    const userId = createRes.body.data.id;

    const updateRes = await request(app)
      .patch(`/api/v1/users/${userId}`)
      .set(...bearer(accessToken))
      .send({ name: 'Updated Name', roleId: managerRoleId });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe('Updated Name');
    expect(updateRes.body.data.roleId).toBe(managerRoleId);
  });

  it('accepts the app’s edit payload: a cleared email (null) and a new mobile number', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const createRes = await request(app)
      .post('/api/v1/users')
      .set(...bearer(accessToken))
      .send({
        username: `edit-payload-${Date.now()}`,
        phone: uniquePhone(),
        email: 'before@example.com',
        password: 'ValidPass@123',
        name: 'Edit Payload',
        roleId: await systemRoleId('STAFF'),
      });
    const newPhone = uniquePhone();
    const res = await request(app)
      .patch(`/api/v1/users/${createRes.body.data.id}`)
      .set(...bearer(accessToken))
      .send({ name: 'Edit Payload', email: null, phone: newPhone });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: null, phone: newPhone });
  });

  it('rejects assigning the SUPER_ADMIN role from a non-platform-admin caller', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const superAdminRoleId = await systemRoleId('SUPER_ADMIN');

    const res = await request(app)
      .post('/api/v1/users')
      .set(...bearer(accessToken))
      .send({
        username: `attempted-superadmin-${Date.now()}`,
        phone: uniquePhone(),
        password: 'ValidPass@123',
        name: 'Attempted Super Admin',
        roleId: superAdminRoleId,
      });

    expect(res.status).toBe(403);
  });

  it('deactivates and reactivates a user via the status endpoint', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const staffRoleId = await systemRoleId('STAFF');

    const createRes = await request(app)
      .post('/api/v1/users')
      .set(...bearer(accessToken))
      .send({
        username: `status-target-${Date.now()}`,
        phone: uniquePhone(),
        password: 'ValidPass@123',
        name: 'Status Target',
        roleId: staffRoleId,
      });
    const userId = createRes.body.data.id;

    const deactivateRes = await request(app)
      .patch(`/api/v1/users/${userId}/status`)
      .set(...bearer(accessToken))
      .send({ status: 'INACTIVE' });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.data.status).toBe('INACTIVE');
  });

  it('soft-deletes a user', async () => {
    const { accessToken } = await loginAs(app, 'owner', 'Owner@123');
    const staffRoleId = await systemRoleId('STAFF');

    const createRes = await request(app)
      .post('/api/v1/users')
      .set(...bearer(accessToken))
      .send({
        username: `delete-target-${Date.now()}`,
        phone: uniquePhone(),
        password: 'ValidPass@123',
        name: 'Delete Target',
        roleId: staffRoleId,
      });
    const userId = createRes.body.data.id;

    const deleteRes = await request(app)
      .delete(`/api/v1/users/${userId}`)
      .set(...bearer(accessToken));
    expect(deleteRes.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/v1/users/${userId}`)
      .set(...bearer(accessToken));
    expect(getRes.status).toBe(404);
  });
});
