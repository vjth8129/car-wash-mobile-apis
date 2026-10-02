import { z } from 'zod';
import { normalizePhone } from '../utils/phone';

/** A mobile number in any common format, normalised to E.164 (e.g. +919876543210). */
export const phoneField = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid mobile number' });
      return z.NEVER;
    }
    return phone;
  });
