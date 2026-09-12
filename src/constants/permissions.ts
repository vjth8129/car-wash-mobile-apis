/**
 * Canonical permission keys seeded into the `permissions` table.
 * Authorization middleware compares against DB-stored permissions, never against this
 * list directly - this exists only as a single source of truth for seeding and for
 * typed references in code (e.g. requirePermission(PERMISSIONS.SERVICES_CREATE)).
 */
export const PERMISSIONS = {
  USERS_VIEW: 'USERS_VIEW',
  USERS_CREATE: 'USERS_CREATE',
  USERS_UPDATE: 'USERS_UPDATE',
  USERS_DELETE: 'USERS_DELETE',

  ROLES_VIEW: 'ROLES_VIEW',
  ROLES_CREATE: 'ROLES_CREATE',
  ROLES_UPDATE: 'ROLES_UPDATE',
  ROLES_DELETE: 'ROLES_DELETE',

  PERMISSIONS_VIEW: 'PERMISSIONS_VIEW',

  SERVICES_VIEW: 'SERVICES_VIEW',
  SERVICES_CREATE: 'SERVICES_CREATE',
  SERVICES_UPDATE: 'SERVICES_UPDATE',
  SERVICES_DELETE: 'SERVICES_DELETE',

  CUSTOMERS_VIEW: 'CUSTOMERS_VIEW',
  CUSTOMERS_CREATE: 'CUSTOMERS_CREATE',
  CUSTOMERS_UPDATE: 'CUSTOMERS_UPDATE',
  CUSTOMERS_DELETE: 'CUSTOMERS_DELETE',

  VEHICLES_VIEW: 'VEHICLES_VIEW',
  VEHICLES_CREATE: 'VEHICLES_CREATE',
  VEHICLES_UPDATE: 'VEHICLES_UPDATE',
  VEHICLES_DELETE: 'VEHICLES_DELETE',

  BOOKINGS_VIEW: 'BOOKINGS_VIEW',
  BOOKINGS_CREATE: 'BOOKINGS_CREATE',
  BOOKINGS_UPDATE: 'BOOKINGS_UPDATE',
  BOOKINGS_CANCEL: 'BOOKINGS_CANCEL',

  ORDERS_VIEW: 'ORDERS_VIEW',
  ORDERS_CREATE: 'ORDERS_CREATE',
  ORDERS_UPDATE: 'ORDERS_UPDATE',

  REPORTS_VIEW: 'REPORTS_VIEW',

  CAR_WASH_VIEW: 'CAR_WASH_VIEW',
  CAR_WASH_CREATE: 'CAR_WASH_CREATE',
  CAR_WASH_UPDATE: 'CAR_WASH_UPDATE',
  CAR_WASH_DELETE: 'CAR_WASH_DELETE',

  MENU_VIEW: 'MENU_VIEW',
  MENU_MANAGE: 'MENU_MANAGE',

  DASHBOARD_VIEW: 'DASHBOARD_VIEW',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DEFINITIONS: Array<{
  key: PermissionKey;
  name: string;
  module: string;
  description: string;
}> = [
  {
    key: PERMISSIONS.USERS_VIEW,
    name: 'View Users',
    module: 'USERS',
    description: 'View users within the car wash',
  },
  {
    key: PERMISSIONS.USERS_CREATE,
    name: 'Create Users',
    module: 'USERS',
    description: 'Create new users',
  },
  {
    key: PERMISSIONS.USERS_UPDATE,
    name: 'Update Users',
    module: 'USERS',
    description: 'Update existing users',
  },
  {
    key: PERMISSIONS.USERS_DELETE,
    name: 'Delete Users',
    module: 'USERS',
    description: 'Remove users',
  },

  { key: PERMISSIONS.ROLES_VIEW, name: 'View Roles', module: 'ROLES', description: 'View roles' },
  {
    key: PERMISSIONS.ROLES_CREATE,
    name: 'Create Roles',
    module: 'ROLES',
    description: 'Create roles',
  },
  {
    key: PERMISSIONS.ROLES_UPDATE,
    name: 'Update Roles',
    module: 'ROLES',
    description: 'Update roles',
  },
  {
    key: PERMISSIONS.ROLES_DELETE,
    name: 'Delete Roles',
    module: 'ROLES',
    description: 'Delete roles',
  },

  {
    key: PERMISSIONS.PERMISSIONS_VIEW,
    name: 'View Permissions',
    module: 'PERMISSIONS',
    description: 'View available permissions',
  },

  {
    key: PERMISSIONS.SERVICES_VIEW,
    name: 'View Services',
    module: 'SERVICES',
    description: 'View services',
  },
  {
    key: PERMISSIONS.SERVICES_CREATE,
    name: 'Create Services',
    module: 'SERVICES',
    description: 'Create services',
  },
  {
    key: PERMISSIONS.SERVICES_UPDATE,
    name: 'Update Services',
    module: 'SERVICES',
    description: 'Update services',
  },
  {
    key: PERMISSIONS.SERVICES_DELETE,
    name: 'Delete Services',
    module: 'SERVICES',
    description: 'Delete services',
  },

  {
    key: PERMISSIONS.CUSTOMERS_VIEW,
    name: 'View Customers',
    module: 'CUSTOMERS',
    description: 'View customers',
  },
  {
    key: PERMISSIONS.CUSTOMERS_CREATE,
    name: 'Create Customers',
    module: 'CUSTOMERS',
    description: 'Create customers',
  },
  {
    key: PERMISSIONS.CUSTOMERS_UPDATE,
    name: 'Update Customers',
    module: 'CUSTOMERS',
    description: 'Update customers',
  },
  {
    key: PERMISSIONS.CUSTOMERS_DELETE,
    name: 'Delete Customers',
    module: 'CUSTOMERS',
    description: 'Delete customers',
  },

  {
    key: PERMISSIONS.VEHICLES_VIEW,
    name: 'View Vehicles',
    module: 'VEHICLES',
    description: 'View vehicles',
  },
  {
    key: PERMISSIONS.VEHICLES_CREATE,
    name: 'Create Vehicles',
    module: 'VEHICLES',
    description: 'Create vehicles',
  },
  {
    key: PERMISSIONS.VEHICLES_UPDATE,
    name: 'Update Vehicles',
    module: 'VEHICLES',
    description: 'Update vehicles',
  },
  {
    key: PERMISSIONS.VEHICLES_DELETE,
    name: 'Delete Vehicles',
    module: 'VEHICLES',
    description: 'Delete vehicles',
  },

  {
    key: PERMISSIONS.BOOKINGS_VIEW,
    name: 'View Bookings',
    module: 'BOOKINGS',
    description: 'View bookings',
  },
  {
    key: PERMISSIONS.BOOKINGS_CREATE,
    name: 'Create Bookings',
    module: 'BOOKINGS',
    description: 'Create bookings',
  },
  {
    key: PERMISSIONS.BOOKINGS_UPDATE,
    name: 'Update Bookings',
    module: 'BOOKINGS',
    description: 'Update bookings',
  },
  {
    key: PERMISSIONS.BOOKINGS_CANCEL,
    name: 'Cancel Bookings',
    module: 'BOOKINGS',
    description: 'Cancel bookings',
  },

  {
    key: PERMISSIONS.ORDERS_VIEW,
    name: 'View Orders',
    module: 'ORDERS',
    description: 'View orders/jobs',
  },
  {
    key: PERMISSIONS.ORDERS_CREATE,
    name: 'Create Orders',
    module: 'ORDERS',
    description: 'Create orders/jobs',
  },
  {
    key: PERMISSIONS.ORDERS_UPDATE,
    name: 'Update Orders',
    module: 'ORDERS',
    description: 'Update orders/jobs',
  },

  {
    key: PERMISSIONS.REPORTS_VIEW,
    name: 'View Reports',
    module: 'REPORTS',
    description: 'View reports',
  },

  {
    key: PERMISSIONS.CAR_WASH_VIEW,
    name: 'View Car Washes',
    module: 'CAR_WASH',
    description: 'View car wash details',
  },
  {
    key: PERMISSIONS.CAR_WASH_CREATE,
    name: 'Create Car Washes',
    module: 'CAR_WASH',
    description: 'Create new car washes (platform)',
  },
  {
    key: PERMISSIONS.CAR_WASH_UPDATE,
    name: 'Update Car Washes',
    module: 'CAR_WASH',
    description: 'Update car wash details',
  },
  {
    key: PERMISSIONS.CAR_WASH_DELETE,
    name: 'Delete Car Washes',
    module: 'CAR_WASH',
    description: 'Disable/delete car washes (platform)',
  },

  {
    key: PERMISSIONS.MENU_VIEW,
    name: 'View Menu',
    module: 'APP',
    description: 'Retrieve dynamic application menu',
  },
  {
    key: PERMISSIONS.MENU_MANAGE,
    name: 'Manage Menu',
    module: 'APP',
    description: 'Manage application menu configuration (platform)',
  },

  {
    key: PERMISSIONS.DASHBOARD_VIEW,
    name: 'View Dashboard',
    module: 'APP',
    description: 'View dashboard summary',
  },
];
