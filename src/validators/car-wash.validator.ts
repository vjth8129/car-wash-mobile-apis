import { z } from 'zod';
import { PASSWORD_COMPLEXITY_MESSAGE, isPasswordComplex } from '../utils/password';
import { phoneField } from './phone.validator';

/** The first OWNER account, created together with the car wash when onboarding a tenant. */
const onboardingOwnerSchema = z.object({
  name: z.string().min(2).max(150),
  phone: phoneField,
  username: z.string().min(3).max(100),
  password: z.string().refine(isPasswordComplex, { message: PASSWORD_COMPLEXITY_MESSAGE }),
  email: z.string().email().optional(),
});

/** GSTIN: 2-digit state code, PAN, entity number, "Z", check character - e.g. 29ABCDE1234F1Z5. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const gstNumberField = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/\s/g, ''))
  .refine((v) => GSTIN_PATTERN.test(v), { message: 'Enter a valid 15-character GSTIN' });

const latitudeField = z.number().min(-90).max(90);
const longitudeField = z.number().min(-180).max(180);

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
  gstNumber: gstNumberField.optional(),
  address: z.string().optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  latitude: latitudeField.optional(),
  longitude: longitudeField.optional(),
  logo: z.string().optional(),
  timezone: z.string().default('Asia/Kolkata'),
  currency: z.string().default('INR'),
});

export const onboardCarWashSchema = createCarWashSchema.extend({
  owner: onboardingOwnerSchema.optional(),
});

export const updateCarWashSchema = createCarWashSchema.partial().extend({
  // PENDING is only ever set by a self sign-up; an admin approves (ACTIVE) or rejects (INACTIVE) it.
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});

/**
 * A car wash owner signing up from the app. The car wash starts PENDING until a platform admin
 * reviews it, so GSTIN and the shop's location (from the phone's GPS) are required.
 */
export const selfSignupSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).optional(),
  phone: phoneField.optional(),
  email: z.string().trim().email().optional(),
  gstNumber: gstNumberField,
  address: z.string().trim().min(5, 'Enter the shop address').max(500),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  country: z.string().trim().max(100).default('India'),
  postalCode: z.string().trim().min(3).max(20),
  latitude: latitudeField,
  longitude: longitudeField,
  owner: z.object({
    name: z.string().trim().min(2).max(150),
    phone: phoneField,
    email: z.string().trim().email().optional(),
    password: z.string().refine(isPasswordComplex, { message: PASSWORD_COMPLEXITY_MESSAGE }),
  }),
});

export const carWashIdParamSchema = z.object({ id: z.string().uuid() });

export const listCarWashesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']).optional(),
});
