ALTER TYPE "public"."car_wash_status" ADD VALUE 'PENDING';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "car_wash_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"car_wash_id" uuid NOT NULL,
	"address" text,
	"city" varchar(100),
	"state" varchar(100),
	"country" varchar(100),
	"postal_code" varchar(20),
	"latitude" double precision,
	"longitude" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "car_washes" ADD COLUMN "gst_number" varchar(15);--> statement-breakpoint
ALTER TABLE "car_washes" ADD COLUMN "source" varchar(20) DEFAULT 'ADMIN' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "car_wash_addresses" ADD CONSTRAINT "car_wash_addresses_car_wash_id_car_washes_id_fk" FOREIGN KEY ("car_wash_id") REFERENCES "public"."car_washes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "car_wash_addresses_car_wash_id_idx" ON "car_wash_addresses" USING btree ("car_wash_id");--> statement-breakpoint
-- Move each car wash's existing address into its own row before 0009 drops the old columns.
INSERT INTO "car_wash_addresses" ("car_wash_id", "address", "city", "state", "country", "postal_code", "latitude", "longitude")
SELECT "id", "address", "city", "state", "country", "postal_code", "latitude", "longitude" FROM "car_washes"
ON CONFLICT ("car_wash_id") DO NOTHING;
