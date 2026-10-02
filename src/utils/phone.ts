/** Country code assumed for bare 10-digit numbers (the platform currently operates in India). */
const DEFAULT_COUNTRY_CODE = '91';

/**
 * Normalises a mobile number to E.164 (`+919876543210`) so the same phone typed as
 * "98765 43210", "+91-98765-43210" or "098765 43210" maps to one stored value.
 * Returns null when the input can't be a phone number.
 *
 * Keep in sync with the backfill in migration 0003_phone_login.sql.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  let e164: string;
  if (trimmed.startsWith('+')) {
    e164 = digits;
  } else if (digits.length === 10) {
    e164 = DEFAULT_COUNTRY_CODE + digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    e164 = DEFAULT_COUNTRY_CODE + digits.slice(1);
  } else {
    e164 = digits;
  }
  // E.164 allows up to 15 digits; anything shorter than 10 isn't a mobile number.
  if (e164.length < 10 || e164.length > 15 || e164.startsWith('0')) return null;
  return `+${e164}`;
}

/** Heuristic for the login field: digits/spaces/dashes/parens with an optional leading +. */
export function looksLikePhone(input: string): boolean {
  return /^\+?[\d\s\-()]{8,}$/.test(input.trim());
}
