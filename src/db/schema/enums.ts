import { pgEnum } from 'drizzle-orm/pg-core';

export const carWashStatusEnum = pgEnum('car_wash_status', ['ACTIVE', 'INACTIVE', 'SUSPENDED']);

export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'INACTIVE', 'SUSPENDED']);

export const statusEnum = pgEnum('status', ['ACTIVE', 'INACTIVE']);

export const vehicleTypeEnum = pgEnum('vehicle_type', [
  'SEDAN',
  'SUV',
  'HATCHBACK',
  'TRUCK',
  'VAN',
  'MOTORCYCLE',
  'OTHER',
]);

export const bookingStatusEnum = pgEnum('booking_status', [
  'PENDING',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

export const orderStatusEnum = pgEnum('order_status', [
  'CREATED',
  'CHECKED_IN',
  'WASHING',
  'READY',
  'COMPLETED',
  'CANCELLED',
]);
