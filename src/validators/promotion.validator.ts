import { z } from 'zod';
import { PROMOTION_CHANNELS, PROMOTION_STATUSES } from '../db/schema';

/** Most customers one promotion goes to. */
export const MAX_RECIPIENTS = 2000;

export const createPromotionSchema = z.object({
  title: z.string().trim().min(1, 'Give the promotion a title').max(150),
  /** {name} is replaced with each customer's first name. */
  message: z.string().trim().min(1, 'Write the message').max(1000),
  channel: z.enum(PROMOTION_CHANNELS).default('WHATSAPP'),
  customerIds: z
    .array(z.string().uuid())
    .min(1, 'Pick at least one customer')
    .max(MAX_RECIPIENTS, `At most ${MAX_RECIPIENTS} customers per promotion`),
  /** When to send (ISO time with offset); left out or null sends it now. */
  sendAt: z.string().datetime({ offset: true }).nullish(),
  /** How the group was picked, shown with the promotion, e.g. "Basic Wash · last 7 days". */
  audienceLabel: z.string().trim().max(200).optional(),
  /** The filters behind the group, kept for reference. */
  audience: z.record(z.unknown()).optional(),
});

export const listPromotionsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(PROMOTION_STATUSES).optional(),
});

export const promotionIdParamSchema = z.object({ id: z.string().uuid() });

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
