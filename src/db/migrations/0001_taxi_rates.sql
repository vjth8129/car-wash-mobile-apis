CREATE TYPE "public"."vehicle_category" AS ENUM('PRIVATE', 'TAXI');--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "taxi_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "vehicle_category" "vehicle_category" DEFAULT 'PRIVATE' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "price" numeric(10, 2);--> statement-breakpoint
-- Backfill: existing bookings were all private-rate, so snapshot the service's current price.
UPDATE "bookings" SET "price" = "services"."price" FROM "services" WHERE "bookings"."service_id" = "services"."id" AND "bookings"."price" IS NULL;
