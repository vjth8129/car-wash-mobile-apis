-- Users now sign in with their mobile number. Normalise stored numbers to E.164 first
-- (mirrors utils/phone.ts normalizePhone) so they match what the API looks up; values that
-- can't be a phone number are left untouched.
UPDATE "users" SET "phone" = NULL WHERE "phone" IS NOT NULL AND btrim("phone") = '';
--> statement-breakpoint
UPDATE "users" AS u
SET "phone" = n.e164
FROM (
  SELECT
    id,
    CASE
      WHEN btrim("phone") LIKE '+%' THEN '+' || d
      WHEN length(d) = 10 THEN '+91' || d
      WHEN length(d) = 11 AND d LIKE '0%' THEN '+91' || substr(d, 2)
      ELSE '+' || d
    END AS e164
  FROM (SELECT id, "phone", regexp_replace("phone", '\D', '', 'g') AS d FROM "users" WHERE "phone" IS NOT NULL) AS raw
) AS n
WHERE u.id = n.id
  AND length(n.e164) BETWEEN 11 AND 16
  AND n.e164 NOT LIKE '+0%'
  AND u."phone" IS DISTINCT FROM n.e164;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_idx" ON "users" USING btree ("phone") WHERE "users"."deleted_at" IS NULL;
