import { z } from 'zod';

export const createCarWashSchema = z.object({
  name: z.string().min(2).max(150),
  code: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/i, 'Code must be alphanumeric with optional - or _'),
  description: z.string().optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  logo: z.string().optional(),
  timezone: z.string().default('Asia/Kolkata'),
  currency: z.string().default('INR'),
});

export const updateCarWashSchema = createCarWashSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});

export const carWashIdParamSchema = z.object({ id: z.string().uuid() });

export const listCarWashesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});
