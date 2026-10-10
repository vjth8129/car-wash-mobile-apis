import { z } from 'zod';

export const createVehicleCategorySchema = z.object({
  name: z.string().trim().min(2).max(50),
  /** Defaults to the name in UPPER_SNAKE_CASE. Can't be changed later. */
  code: z.string().trim().min(2).max(30).optional(),
  description: z.string().max(200).optional(),
  sortOrder: z.number().int().optional(),
});

export const updateVehicleCategorySchema = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  description: z.string().max(200).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  sortOrder: z.number().int().optional(),
});

export const vehicleCategoryIdParamSchema = z.object({ id: z.string().uuid() });

export const listVehicleCategoriesQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
});
