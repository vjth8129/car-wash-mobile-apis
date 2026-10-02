-- Jobs now go CREATED ("Waiting") -> WASHING -> READY -> COMPLETED (or CANCELLED).
-- CHECKED_IN is gone: a checked-in car that hadn't started washing is waiting.
ALTER TABLE "public"."orders" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."orders" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "public"."orders" SET "status" = 'CREATED' WHERE "status" = 'CHECKED_IN';--> statement-breakpoint
DROP TYPE "public"."order_status";--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('CREATED', 'WASHING', 'READY', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "public"."orders" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING "status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "public"."orders" ALTER COLUMN "status" SET DEFAULT 'CREATED';
