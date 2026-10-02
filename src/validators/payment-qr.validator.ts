import { z } from 'zod';

/** ~560 KB of image data; the app resizes QR images to well under this. */
const MAX_BASE64_LENGTH = 750_000;

export const setPaymentQrSchema = z.object({
  image: z
    .string()
    .regex(
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/,
      'Upload a PNG, JPEG or WebP image',
    )
    .max(MAX_BASE64_LENGTH, 'That image is too large. Use a smaller picture of the QR code.'),
  note: z.string().trim().max(100).optional(),
});
