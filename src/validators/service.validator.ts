import { z } from 'zod';

/** Price per vehicle category; categories left out (or null) are charged `price`. */
const ratesField = z
  .array(z.object({ categoryId: z.string().uuid(), price: z.number().positive().nullable() }))
  .max(50);

export const createServiceSchema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().optional(),
  price: z.number().positive(),
  /** Rate for taxis; null/omitted = same as price. */
  taxiPrice: z.number().positive().nullable().optional(),
  rates: ratesField.optional(),
  durationMinutes: z.number().int().positive(),
  sortOrder: z.number().int().optional(),
});

export const updateServiceSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  taxiPrice: z.number().positive().nullable().optional(),
  rates: ratesField.optional(),
  durationMinutes: z.number().int().positive().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  sortOrder: z.number().int().optional(),
});

export const serviceIdParamSchema = z.object({ id: z.string().uuid() });

export const listServicesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
