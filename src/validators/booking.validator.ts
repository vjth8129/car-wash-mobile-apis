import { z } from 'zod';

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

/** Legacy PRIVATE/TAXI flag from older app builds; vehicleCategoryId supersedes it. */
const vehicleCategory = z.enum(['PRIVATE', 'TAXI']);
const serviceIds = z.array(z.string().uuid()).min(1).max(10);

export const createBookingSchema = z
  .object({
    customerId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    /** One service (older clients). */
    serviceId: z.string().uuid().optional(),
    /** One or more services, in the order they're listed. */
    serviceIds: serviceIds.optional(),
    bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'bookingDate must be YYYY-MM-DD'),
    startTime: z.string().regex(timeRegex, 'startTime must be HH:mm'),
    notes: z.string().optional(),
    vehicleCategoryId: z.string().uuid().optional(),
    vehicleCategory: vehicleCategory.optional(),
  })
  .refine((b) => b.serviceId || b.serviceIds, {
    message: 'Choose at least one service',
    path: ['serviceIds'],
  });

export const updateBookingSchema = z.object({
  vehicleId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  serviceIds: serviceIds.optional(),
  vehicleCategoryId: z.string().uuid().optional(),
  bookingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  startTime: z.string().regex(timeRegex).optional(),
  notes: z.string().optional(),
  vehicleCategory: vehicleCategory.optional(),
});

export const bookingIdParamSchema = z.object({ id: z.string().uuid() });

export const listBookingsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z
    .enum(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
    .optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  customerId: z.string().uuid().optional(),
});

export const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
});
