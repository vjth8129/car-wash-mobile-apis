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

/** Record how the customer paid, or null to undo a mistaken entry. */
export const recordPaymentSchema = z.object({
  method: z.enum(['UPI', 'CASH']).nullable(),
});

export const orderIdParamSchema = z.object({ id: z.string().uuid() });

export const listOrdersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(['CREATED', 'WASHING', 'READY', 'COMPLETED', 'CANCELLED']).optional(),
  /** UNPAID = no payment noted yet (e.g. staff forgot to mark it), PAID = noted. */
  paymentStatus: z.enum(['PAID', 'UNPAID']).optional(),
});
