-- The full legacy 48-bit hash namespace remains reserved, even for lost requests.
CREATE SEQUENCE "public"."mellat_order_id_seq" INCREMENT BY 1 MINVALUE 281474976710656 MAXVALUE 9223372036854775807 START WITH 281474976710656 CACHE 1 NO CYCLE;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "gateway_ref" TYPE varchar(128);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "mellat_order_id" bigint;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_mellat_order_id_unique" UNIQUE("mellat_order_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_mellat_order_id_range" CHECK ("payments"."mellat_order_id" >= 281474976710656 and "payments"."mellat_order_id" <= 9223372036854775807);--> statement-breakpoint
CREATE FUNCTION "public"."protect_mellat_order_id"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.mellat_order_id IS NOT NULL AND (
    NEW.mellat_order_id IS DISTINCT FROM OLD.mellat_order_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
  ) THEN
    RAISE EXCEPTION 'A dispatched Mellat order association cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'payments_mellat_order_id_immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payments_mellat_order_id_immutable"
BEFORE UPDATE OF "mellat_order_id", "id", "order_id", "user_id" ON "public"."payments"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_mellat_order_id"();
