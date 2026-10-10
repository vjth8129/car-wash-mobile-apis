import { relations } from 'drizzle-orm';
import { carWashes } from './car-washes';
import { permissions } from './permissions';
import { roles, rolePermissions } from './roles';
import { users } from './users';
import { menus, menuPermissions } from './menus';
import { services } from './services';
import { customers } from './customers';
import { vehicles } from './vehicles';
import { bookings } from './bookings';
import { bookingServices } from './booking-services';
import { vehicleCategories, serviceRates } from './vehicle-categories';
import { orders } from './orders';
import { refreshTokens, passwordResetTokens } from './tokens';
import { auditLogs } from './audit-logs';

export const carWashesRelations = relations(carWashes, ({ many }) => ({
  users: many(users),
  roles: many(roles),
  services: many(services),
  customers: many(customers),
  vehicles: many(vehicles),
  bookings: many(bookings),
  orders: many(orders),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  carWash: one(carWashes, { fields: [roles.carWashId], references: [carWashes.id] }),
  rolePermissions: many(rolePermissions),
  users: many(users),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  menuPermissions: many(menuPermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  carWash: one(carWashes, { fields: [users.carWashId], references: [carWashes.id] }),
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  refreshTokens: many(refreshTokens),
  passwordResetTokens: many(passwordResetTokens),
}));

export const menusRelations = relations(menus, ({ one, many }) => ({
  parent: one(menus, { fields: [menus.parentId], references: [menus.id] }),
  permission: one(permissions, { fields: [menus.permissionId], references: [permissions.id] }),
  menuPermissions: many(menuPermissions),
}));

export const menuPermissionsRelations = relations(menuPermissions, ({ one }) => ({
  menu: one(menus, { fields: [menuPermissions.menuId], references: [menus.id] }),
  permission: one(permissions, {
    fields: [menuPermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  carWash: one(carWashes, { fields: [services.carWashId], references: [carWashes.id] }),
  bookings: many(bookings),
  rates: many(serviceRates),
}));

export const vehicleCategoriesRelations = relations(vehicleCategories, ({ many }) => ({
  rates: many(serviceRates),
}));

export const serviceRatesRelations = relations(serviceRates, ({ one }) => ({
  service: one(services, { fields: [serviceRates.serviceId], references: [services.id] }),
  category: one(vehicleCategories, {
    fields: [serviceRates.categoryId],
    references: [vehicleCategories.id],
  }),
}));

export const bookingServicesRelations = relations(bookingServices, ({ one }) => ({
  booking: one(bookings, { fields: [bookingServices.bookingId], references: [bookings.id] }),
  service: one(services, { fields: [bookingServices.serviceId], references: [services.id] }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  carWash: one(carWashes, { fields: [customers.carWashId], references: [carWashes.id] }),
  vehicles: many(vehicles),
  bookings: many(bookings),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  carWash: one(carWashes, { fields: [vehicles.carWashId], references: [carWashes.id] }),
  customer: one(customers, { fields: [vehicles.customerId], references: [customers.id] }),
  category: one(vehicleCategories, {
    fields: [vehicles.categoryId],
    references: [vehicleCategories.id],
  }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  carWash: one(carWashes, { fields: [bookings.carWashId], references: [carWashes.id] }),
  customer: one(customers, { fields: [bookings.customerId], references: [customers.id] }),
  vehicle: one(vehicles, { fields: [bookings.vehicleId], references: [vehicles.id] }),
  service: one(services, { fields: [bookings.serviceId], references: [services.id] }),
  createdByUser: one(users, { fields: [bookings.createdBy], references: [users.id] }),
  category: one(vehicleCategories, {
    fields: [bookings.categoryId],
    references: [vehicleCategories.id],
  }),
  items: many(bookingServices),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  carWash: one(carWashes, { fields: [orders.carWashId], references: [carWashes.id] }),
  booking: one(bookings, { fields: [orders.bookingId], references: [bookings.id] }),
  createdByUser: one(users, { fields: [orders.createdBy], references: [users.id] }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
  carWash: one(carWashes, { fields: [auditLogs.carWashId], references: [carWashes.id] }),
}));
