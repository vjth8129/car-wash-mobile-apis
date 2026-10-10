/* eslint-disable no-console */
import { eq, and, isNull } from 'drizzle-orm';
import { db, pool } from './index';
import {
  permissions as permissionsTable,
  roles as rolesTable,
  rolePermissions as rolePermissionsTable,
  users as usersTable,
  carWashes as carWashesTable,
  menus as menusTable,
  services as servicesTable,
  customers as customersTable,
  vehicles as vehiclesTable,
  bookings as bookingsTable,
  bookingServices,
  vehicleCategories,
  DEFAULT_VEHICLE_CATEGORY_CODE,
  orders as ordersTable,
} from './schema';
import { PERMISSION_DEFINITIONS } from '../constants/permissions';
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS, SystemRoleName } from '../constants/roles';
import { hashPassword } from '../utils/password';
import { logger } from '../config/logger';

async function seedPermissions(): Promise<Map<string, string>> {
  for (const def of PERMISSION_DEFINITIONS) {
    await db
      .insert(permissionsTable)
      .values({ key: def.key, name: def.name, description: def.description, module: def.module })
      .onConflictDoNothing({ target: permissionsTable.key });
  }
  const rows = await db.select().from(permissionsTable);
  return new Map(rows.map((r) => [r.key, r.id]));
}

async function seedSystemRoles(
  permissionIdByKey: Map<string, string>,
): Promise<Map<SystemRoleName, string>> {
  const roleIdByName = new Map<SystemRoleName, string>();

  for (const roleName of Object.values(SYSTEM_ROLES)) {
    let role = await db.query.roles.findFirst({
      where: and(eq(rolesTable.name, roleName), isNull(rolesTable.carWashId)),
    });
    if (!role) {
      const [inserted] = await db
        .insert(rolesTable)
        .values({
          name: roleName,
          carWashId: null,
          isSystem: true,
          description: `System role: ${roleName}`,
        })
        .returning();
      role = inserted;
    }
    roleIdByName.set(roleName, role.id);

    const desiredPermissionKeys = SYSTEM_ROLE_PERMISSIONS[roleName];
    const existingLinks = await db
      .select({ permissionId: rolePermissionsTable.permissionId })
      .from(rolePermissionsTable)
      .where(eq(rolePermissionsTable.roleId, role.id));
    const existingPermissionIds = new Set(existingLinks.map((l) => l.permissionId));

    for (const key of desiredPermissionKeys) {
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId || existingPermissionIds.has(permissionId)) continue;
      await db
        .insert(rolePermissionsTable)
        .values({ roleId: role.id, permissionId })
        .onConflictDoNothing({
          target: [rolePermissionsTable.roleId, rolePermissionsTable.permissionId],
        });
    }
  }

  return roleIdByName;
}

async function seedMenus(permissionIdByKey: Map<string, string>) {
  interface MenuDef {
    key: string;
    title: string;
    icon: string;
    route: string | null;
    permissionKey: string | null;
    sortOrder: number;
    parentKey: string | null;
  }

  const menuDefs: MenuDef[] = [
    {
      key: 'dashboard',
      title: 'Dashboard',
      icon: 'dashboard',
      route: '/dashboard',
      permissionKey: 'DASHBOARD_VIEW',
      sortOrder: 1,
      parentKey: null,
    },
    {
      key: 'operations',
      title: 'Operations',
      icon: 'folder',
      route: null,
      permissionKey: null,
      sortOrder: 2,
      parentKey: null,
    },
    {
      key: 'bookings',
      title: 'Bookings',
      icon: 'calendar',
      route: '/bookings',
      permissionKey: 'BOOKINGS_VIEW',
      sortOrder: 1,
      parentKey: 'operations',
    },
    {
      key: 'orders',
      title: 'Orders',
      icon: 'clipboard',
      route: '/orders',
      permissionKey: 'ORDERS_VIEW',
      sortOrder: 2,
      parentKey: 'operations',
    },
    {
      key: 'customers',
      title: 'Customers',
      icon: 'users',
      route: '/customers',
      permissionKey: 'CUSTOMERS_VIEW',
      sortOrder: 3,
      parentKey: 'operations',
    },
    {
      key: 'vehicles',
      title: 'Vehicles',
      icon: 'car',
      route: '/vehicles',
      permissionKey: 'VEHICLES_VIEW',
      sortOrder: 4,
      parentKey: 'operations',
    },
    {
      key: 'management',
      title: 'Management',
      icon: 'folder',
      route: null,
      permissionKey: null,
      sortOrder: 3,
      parentKey: null,
    },
    {
      key: 'users',
      title: 'Users',
      icon: 'user',
      route: '/users',
      permissionKey: 'USERS_VIEW',
      sortOrder: 1,
      parentKey: 'management',
    },
    {
      key: 'roles',
      title: 'Roles',
      icon: 'shield',
      route: '/roles',
      permissionKey: 'ROLES_VIEW',
      sortOrder: 2,
      parentKey: 'management',
    },
    {
      key: 'services',
      title: 'Services',
      icon: 'car-wash',
      route: '/services',
      permissionKey: 'SERVICES_VIEW',
      sortOrder: 3,
      parentKey: 'management',
    },
    {
      key: 'car-washes',
      title: 'Car Washes',
      icon: 'building',
      route: '/car-washes',
      permissionKey: 'CAR_WASH_VIEW',
      sortOrder: 4,
      parentKey: 'management',
    },
    {
      key: 'reports',
      title: 'Reports',
      icon: 'chart',
      route: '/reports',
      permissionKey: 'REPORTS_VIEW',
      sortOrder: 4,
      parentKey: null,
    },
  ];

  const menuIdByKey = new Map<string, string>();

  // Pass 1: create/find top-level and child menus without resolving parent yet.
  for (const def of menuDefs) {
    let menu = await db.query.menus.findFirst({ where: eq(menusTable.key, def.key) });
    if (!menu) {
      const [inserted] = await db
        .insert(menusTable)
        .values({
          key: def.key,
          title: def.title,
          icon: def.icon,
          route: def.route,
          permissionId: def.permissionKey ? permissionIdByKey.get(def.permissionKey) : null,
          sortOrder: def.sortOrder,
        })
        .returning();
      menu = inserted;
    }
    menuIdByKey.set(def.key, menu.id);
  }

  // Pass 2: wire up parentId now that all menus exist.
  for (const def of menuDefs) {
    if (!def.parentKey) continue;
    const menuId = menuIdByKey.get(def.key)!;
    const parentId = menuIdByKey.get(def.parentKey)!;
    await db.update(menusTable).set({ parentId }).where(eq(menusTable.id, menuId));
  }
}

async function seedCarWash() {
  let carWash = await db.query.carWashes.findFirst({
    where: eq(carWashesTable.code, 'SPARKLE001'),
  });
  if (!carWash) {
    const [inserted] = await db
      .insert(carWashesTable)
      .values({
        name: 'Sparkle Car Wash',
        code: 'SPARKLE001',
        description: 'Flagship demo car wash used for development seed data',
        phone: '+91-9999999999',
        email: 'contact@sparklecarwash.example',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postalCode: '560001',
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      })
      .returning();
    carWash = inserted;
  }
  return carWash;
}

async function seedUser(params: {
  username: string;
  phone: string;
  password: string;
  name: string;
  email: string;
  roleId: string;
  carWashId: string | null;
}) {
  let user = await db.query.users.findFirst({ where: eq(usersTable.username, params.username) });
  if (!user) {
    const passwordHash = await hashPassword(params.password);
    const [inserted] = await db
      .insert(usersTable)
      .values({
        username: params.username,
        phone: params.phone,
        passwordHash,
        name: params.name,
        email: params.email,
        roleId: params.roleId,
        carWashId: params.carWashId,
        status: 'ACTIVE',
      })
      .returning();
    user = inserted;
  } else if (!user.phone) {
    // Databases seeded before phone login: give the demo users their sign-in number.
    const [updated] = await db
      .update(usersTable)
      .set({ phone: params.phone })
      .where(eq(usersTable.id, user.id))
      .returning();
    user = updated;
  }
  return user;
}

async function seedServices(carWashId: string) {
  const defs = [
    {
      name: 'Basic Wash',
      description: 'Exterior wash and dry',
      price: '199.00',
      durationMinutes: 20,
      sortOrder: 1,
    },
    {
      name: 'Premium Wash',
      description: 'Exterior + interior vacuum',
      price: '399.00',
      durationMinutes: 40,
      sortOrder: 2,
    },
    {
      name: 'Interior Cleaning',
      description: 'Deep interior cleaning and sanitization',
      price: '299.00',
      durationMinutes: 35,
      sortOrder: 3,
    },
    {
      name: 'Full Detailing',
      description: 'Complete interior + exterior detailing',
      price: '1499.00',
      durationMinutes: 120,
      sortOrder: 4,
    },
  ];
  const created: Record<string, string> = {};
  for (const def of defs) {
    let service = await db.query.services.findFirst({
      where: and(eq(servicesTable.carWashId, carWashId), eq(servicesTable.name, def.name)),
    });
    if (!service) {
      const [inserted] = await db
        .insert(servicesTable)
        .values({ ...def, carWashId })
        .returning();
      service = inserted;
    }
    created[def.name] = service.id;
  }
  return created;
}

async function seedCustomersAndVehicles(carWashId: string) {
  const defs = [
    {
      name: 'Rahul Sharma',
      phone: '+91-9000000001',
      email: 'rahul@example.com',
      vehicle: {
        registrationNumber: 'KA01AB1234',
        brand: 'Maruti',
        model: 'Swift',
        vehicleType: 'HATCHBACK' as const,
      },
    },
    {
      name: 'Priya Nair',
      phone: '+91-9000000002',
      email: 'priya@example.com',
      vehicle: {
        registrationNumber: 'KA02CD5678',
        brand: 'Hyundai',
        model: 'Creta',
        vehicleType: 'SUV' as const,
      },
    },
  ];
  const result: { customerId: string; vehicleId: string }[] = [];
  for (const def of defs) {
    let customer = await db.query.customers.findFirst({
      where: and(eq(customersTable.carWashId, carWashId), eq(customersTable.phone, def.phone)),
    });
    if (!customer) {
      const [inserted] = await db
        .insert(customersTable)
        .values({ carWashId, name: def.name, phone: def.phone, email: def.email })
        .returning();
      customer = inserted;
    }

    let vehicle = await db.query.vehicles.findFirst({
      where: and(
        eq(vehiclesTable.carWashId, carWashId),
        eq(vehiclesTable.registrationNumber, def.vehicle.registrationNumber),
      ),
    });
    if (!vehicle) {
      const [inserted] = await db
        .insert(vehiclesTable)
        .values({ carWashId, customerId: customer.id, ...def.vehicle })
        .returning();
      vehicle = inserted;
    }
    result.push({ customerId: customer.id, vehicleId: vehicle.id });
  }
  return result;
}

async function seedBookingsAndOrders(
  carWashId: string,
  createdBy: string,
  customersAndVehicles: { customerId: string; vehicleId: string }[],
  serviceIdByName: Record<string, string>,
) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const first = customersAndVehicles[0];
  if (!first) return;

  let booking = await db.query.bookings.findFirst({
    where: and(
      eq(bookingsTable.carWashId, carWashId),
      eq(bookingsTable.customerId, first.customerId),
      eq(bookingsTable.vehicleId, first.vehicleId),
      eq(bookingsTable.bookingDate, tomorrow),
    ),
  });
  if (!booking) {
    const [inserted] = await db
      .insert(bookingsTable)
      .values({
        carWashId,
        customerId: first.customerId,
        vehicleId: first.vehicleId,
        serviceId: serviceIdByName['Basic Wash'],
        bookingDate: tomorrow,
        startTime: '10:00',
        endTime: '10:20',
        status: 'CONFIRMED',
        notes: 'Seed data sample booking',
        price: '199.00',
        categoryId: (
          await db.query.vehicleCategories.findFirst({
            where: eq(vehicleCategories.code, DEFAULT_VEHICLE_CATEGORY_CODE),
          })
        )?.id,
        createdBy,
      })
      .returning();
    booking = inserted;
    await db.insert(bookingServices).values({
      bookingId: booking.id,
      serviceId: serviceIdByName['Basic Wash'],
      name: 'Basic Wash',
      price: '199.00',
      durationMinutes: 20,
    });
  }

  const existingOrder = await db.query.orders.findFirst({
    where: eq(ordersTable.bookingId, booking.id),
  });
  if (!existingOrder) {
    await db.insert(ordersTable).values({
      carWashId,
      bookingId: booking.id,
      status: 'CREATED',
      createdBy,
    });
  }
}

export async function seedDatabase(): Promise<void> {
  logger.info('Starting database seed...');

  const permissionIdByKey = await seedPermissions();
  logger.info(`Seeded ${permissionIdByKey.size} permissions`);

  const roleIdByName = await seedSystemRoles(permissionIdByKey);
  logger.info('Seeded system roles: SUPER_ADMIN, OWNER, MANAGER, STAFF, CUSTOMER');

  await seedMenus(permissionIdByKey);
  logger.info('Seeded application menus');

  await seedUser({
    username: 'superadmin',
    phone: '+919000000100',
    password: 'SuperAdmin@123',
    name: 'Platform Super Admin',
    email: 'superadmin@carwash.local',
    roleId: roleIdByName.get('SUPER_ADMIN')!,
    carWashId: null,
  });
  logger.info('Seeded platform super admin (9000000100 / SuperAdmin@123)');

  const carWash = await seedCarWash();
  logger.info(`Seeded car wash: ${carWash.name} (${carWash.code})`);

  await seedUser({
    username: 'owner',
    phone: '+919000000101',
    password: 'Owner@123',
    name: 'Sparkle Owner',
    email: 'owner@sparklecarwash.example',
    roleId: roleIdByName.get('OWNER')!,
    carWashId: carWash.id,
  });
  const manager = await seedUser({
    username: 'manager',
    phone: '+919000000102',
    password: 'Manager@123',
    name: 'Sparkle Manager',
    email: 'manager@sparklecarwash.example',
    roleId: roleIdByName.get('MANAGER')!,
    carWashId: carWash.id,
  });
  await seedUser({
    username: 'staff',
    phone: '+919000000103',
    password: 'Staff@123',
    name: 'Sparkle Staff',
    email: 'staff@sparklecarwash.example',
    roleId: roleIdByName.get('STAFF')!,
    carWashId: carWash.id,
  });
  logger.info('Seeded owner / manager / staff users for Sparkle Car Wash');

  const serviceIdByName = await seedServices(carWash.id);
  logger.info(`Seeded ${Object.keys(serviceIdByName).length} services`);

  const customersAndVehicles = await seedCustomersAndVehicles(carWash.id);
  logger.info(`Seeded ${customersAndVehicles.length} customers with vehicles`);

  await seedBookingsAndOrders(carWash.id, manager.id, customersAndVehicles, serviceIdByName);
  logger.info('Seeded sample booking and order');

  logger.info('Database seed completed successfully.');
  logger.info('--- Development credentials (do NOT use in production) ---');
  logger.info('Sign in with mobile number (or username) + password:');
  logger.info('9000000100 (superadmin) / SuperAdmin@123');
  logger.info('9000000101 (owner) / Owner@123');
  logger.info('9000000102 (manager) / Manager@123');
  logger.info('9000000103 (staff) / Staff@123');
}

// Only auto-run (and close the pool) when executed directly via `npm run db:seed`.
// When imported (e.g. from tests/helpers), the caller owns the pool lifecycle.
if (require.main === module) {
  seedDatabase()
    .catch((err) => {
      logger.error({ err }, 'Seed failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
