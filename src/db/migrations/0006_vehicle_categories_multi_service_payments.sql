CREATE TABLE IF NOT EXISTS "service_rates" (
	"service_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	CONSTRAINT "service_rates_service_id_category_id_pk" PRIMARY KEY("service_id","category_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" varchar(200),
	"status" "status" DEFAULT 'ACTIVE' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_rates" ADD CONSTRAINT "service_rates_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_rates" ADD CONSTRAINT "service_rates_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_rates_category_id_idx" ON "service_rates" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_services_booking_id_idx" ON "booking_services" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_services_service_id_idx" ON "booking_services" USING btree ("service_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Built-in categories (more can be added from the admin portal).
INSERT INTO "vehicle_categories" ("code", "name", "sort_order") VALUES ('PRIVATE', 'Private', 0), ('TAXI', 'Taxi', 1) ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- Existing taxi rates become service_rates rows.
INSERT INTO "service_rates" ("service_id", "category_id", "price")
  SELECT s."id", c."id", s."taxi_price" FROM "services" s JOIN "vehicle_categories" c ON c."code" = 'TAXI'
  WHERE s."taxi_price" IS NOT NULL
  ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "bookings" b SET "category_id" = c."id" FROM "vehicle_categories" c
  WHERE c."code" = b."vehicle_category"::text AND b."category_id" IS NULL;--> statement-breakpoint
-- Every existing booking was for exactly one service.
INSERT INTO "booking_services" ("booking_id", "service_id", "name", "price", "duration_minutes")
  SELECT b."id", s."id", s."name", COALESCE(b."price", s."price"), s."duration_minutes"
  FROM "bookings" b JOIN "services" s ON s."id" = b."service_id"
  WHERE NOT EXISTS (SELECT 1 FROM "booking_services" bs WHERE bs."booking_id" = b."id");--> statement-breakpoint
UPDATE "bookings" b SET "price" = s."price" FROM "services" s WHERE s."id" = b."service_id" AND b."price" IS NULL;--> statement-breakpoint
-- Each vehicle keeps the category of its latest booking (private when it has none).
UPDATE "vehicles" v SET "category_id" = COALESCE(
  (SELECT b."category_id" FROM "bookings" b WHERE b."vehicle_id" = v."id" ORDER BY b."created_at" DESC LIMIT 1),
  (SELECT c."id" FROM "vehicle_categories" c WHERE c."code" = 'PRIVATE')
) WHERE v."category_id" IS NULL;
