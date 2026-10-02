import { z } from 'zod';

export const createOrderSchema = z.object({
  bookingId: z.string().uuid(),
});

export const updateOrderStatusSchema = z.object({
  status: z
    .enum(['WASHING', 'READY', 'COMPLETED', 'CANCELLED', 'CHECKED_IN'])
    // App builds from before the simplified workflow send CHECKED_IN as their first step
    // ("Check in car"); treat it as starting the wash so those builds keep working.
    .transform((s) => (s === 'CHECKED_IN' ? 'WASHING' : s)),
});

export const orderIdParamSchema = z.object({ id: z.string().uuid() });

export const listOrdersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(['CREATED', 'WASHING', 'READY', 'COMPLETED', 'CANCELLED']).optional(),
});
