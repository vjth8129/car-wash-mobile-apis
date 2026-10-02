import { z } from 'zod';
import { PASSWORD_COMPLEXITY_MESSAGE, isPasswordComplex } from '../utils/password';
import { phoneField } from './phone.validator';

export const createUserSchema = z.object({
  username: z.string().min(3).max(100),
  password: z.string().refine(isPasswordComplex, { message: PASSWORD_COMPLEXITY_MESSAGE }),
  name: z.string().min(2).max(150),
  email: z.string().email().optional(),
  // The user signs in with this number.
  phone: phoneField,
  roleId: z.string().uuid(),
  /** Platform admins only: the car wash to add the user to. Ignored for everyone else. */
  carWashId: z.string().uuid().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  // null clears it.
  email: z.string().email().nullable().optional(),
  phone: phoneField.optional(),
  roleId: z.string().uuid().optional(),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
});

export const resetUserPasswordSchema = z.object({
  newPassword: z.string().refine(isPasswordComplex, { message: PASSWORD_COMPLEXITY_MESSAGE }),
});

export const userIdParamSchema = z.object({ id: z.string().uuid() });

export const listUsersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  /** Platform admins only: restrict to one car wash. */
  carWashId: z.string().uuid().optional(),
});
