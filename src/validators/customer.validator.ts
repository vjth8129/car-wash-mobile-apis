import { z } from 'zod';

export const createCustomerSchema = z.object({
  name: z.string().min(2).max(150),
  phone: z.string().min(5).max(30),
  email: z.string().email().optional(),
  address: z.string().optional(),
});

export const updateCustomerSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  phone: z.string().min(5).max(30).optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const customerIdParamSchema = z.object({ id: z.string().uuid() });

export const listCustomersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
