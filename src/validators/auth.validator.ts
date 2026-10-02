import { z } from 'zod';
import { PASSWORD_COMPLEXITY_MESSAGE, isPasswordComplex } from '../utils/password';

/**
 * Users sign in with their mobile number. `username` is still accepted for older
 * accounts that have no phone on file (and for clients predating phone login).
 */
const accountIdentifier = {
  phone: z.string().trim().min(1, 'Mobile number is required').optional(),
  username: z.string().trim().min(1, 'Username is required').optional(),
};
const oneIdentifier = (v: { phone?: string; username?: string }) => !!v.phone !== !!v.username;
const oneIdentifierMessage = { message: 'Provide either a mobile number or a username' };

export const loginSchema = z
  .object({ ...accountIdentifier, password: z.string().min(1, 'Password is required') })
  .refine(oneIdentifier, oneIdentifierMessage);

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export const forgotPasswordSchema = z
  .object(accountIdentifier)
  .refine(oneIdentifier, oneIdentifierMessage);

export const resetPasswordSchema = z
  .object({
    ...accountIdentifier,
    code: z.string().regex(/^\d{4,6}$/, 'Enter the code you received'),
    newPassword: z.string().refine(isPasswordComplex, { message: PASSWORD_COMPLEXITY_MESSAGE }),
  })
  .refine(oneIdentifier, oneIdentifierMessage);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().refine(isPasswordComplex, { message: PASSWORD_COMPLEXITY_MESSAGE }),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type AccountIdentifier = { phone?: string; username?: string };
