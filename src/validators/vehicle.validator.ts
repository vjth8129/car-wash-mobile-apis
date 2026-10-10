import { z } from 'zod';

const vehicleTypeEnum = z.enum([
  'SEDAN',
  'SUV',
  'HATCHBACK',
  'TRUCK',
  'VAN',
  'MOTORCYCLE',
  'OTHER',
]);

export const createVehicleSchema = z.object({
  customerId: z.string().uuid(),
  registrationNumber: z.string().min(2).max(30),
  brand: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  variant: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  vehicleType: vehicleTypeEnum.default('OTHER'),
  /** Private / taxi / ...; defaults to Private. */
  categoryId: z.string().uuid().optional(),
});

export const updateVehicleSchema = z.object({
  registrationNumber: z.string().min(2).max(30).optional(),
  brand: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  variant: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  vehicleType: vehicleTypeEnum.optional(),
  categoryId: z.string().uuid().optional(),
});

export const vehicleIdParamSchema = z.object({ id: z.string().uuid() });

export const listVehiclesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  customerId: z.string().uuid().optional(),
});
