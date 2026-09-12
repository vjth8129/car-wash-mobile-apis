import { z } from 'zod';

export const createOrderSchema = z.object({
  bookingId: z.string().uuid(),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['CHECKED_IN', 'WASHING', 'READY', 'COMPLETED', 'CANCELLED']),
});

export const orderIdParamSchema = z.object({ id: z.string().uuid() });

export const listOrdersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z
    .enum(['CREATED', 'CHECKED_IN', 'WASHING', 'READY', 'COMPLETED', 'CANCELLED'])
    .optional(),
});
