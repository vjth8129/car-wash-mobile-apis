CREATE TABLE IF NOT EXISTS "car_wash_payment_qrs" (
	"car_wash_id" uuid PRIMARY KEY NOT NULL,
	"image" text NOT NULL,
	"note" varchar(100),
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "car_wash_payment_qrs" ADD CONSTRAINT "car_wash_payment_qrs_car_wash_id_car_washes_id_fk" FOREIGN KEY ("car_wash_id") REFERENCES "public"."car_washes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "car_wash_payment_qrs" ADD CONSTRAINT "car_wash_payment_qrs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
