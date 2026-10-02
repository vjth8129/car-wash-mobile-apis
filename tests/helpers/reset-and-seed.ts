/* eslint-disable no-console */
import { sql, eq, isNull, and } from 'drizzle-orm';
import { db, pool } from '../../src/db';
import { carWashes, roles, services, users } from '../../src/db/schema';
import { seedDatabase } from '../../src/db/seed';
import { hashPassword } from '../../src/utils/password';

async function truncateAll() {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_logs,
      password_reset_tokens,
      refresh_tokens,
      orders,
      bookings,
      vehicles,
      customers,
      services,
      menu_permissions,
      menus,
      role_permissions,
      role_override_permissions,
      role_overrides,
      users,
      roles,
      car_washes,
      permissions
    RESTART IDENTITY CASCADE;
  `);
}

/** Creates a second tenant ("Shine Car Wash") with its own owner and data, used by tenant-isolation tests. */
async function seedSecondTenant() {
  const [carWashB] = await db
    .insert(carWashes)
    .values({
      name: 'Shine Car Wash',
      code: 'SHINE002',
      status: 'ACTIVE',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    })
    .returning();

  const ownerRole = await db.query.roles.findFirst({
    where: and(eq(roles.name, 'OWNER'), isNull(roles.carWashId)),
  });
  if (!ownerRole) throw new Error('OWNER system role not found - run seedDatabase() first');

  const passwordHash = await hashPassword('OwnerB@123');
  const [ownerB] = await db
    .insert(users)
    .values({
      username: 'owner_b',
      phone: '+919000000201',
      passwordHash,
      name: 'Shine Owner',
      email: 'owner@shinecarwash.example',
      roleId: ownerRole.id,
      carWashId: carWashB.id,
      status: 'ACTIVE',
    })
    .returning();

  const [serviceB] = await db
    .insert(services)
    .values({
      carWashId: carWashB.id,
      name: 'Shine Basic Wash',
      price: '150.00',
      durationMinutes: 15,
    })
    .returning();

  return { carWashB, ownerB, serviceB };
}

async function main() {
  console.log('[test-setup] Truncating test database...');
  await truncateAll();

  console.log('[test-setup] Seeding baseline fixtures (tenant A: Sparkle Car Wash)...');
  await seedDatabase();

  console.log('[test-setup] Seeding tenant B (Shine Car Wash) for isolation tests...');
  await seedSecondTenant();

  console.log('[test-setup] Test database ready.');
}

main()
  .catch((err) => {
    console.error('[test-setup] Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
