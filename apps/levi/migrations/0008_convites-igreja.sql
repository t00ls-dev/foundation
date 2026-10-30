-- Expansão aditiva; sem alteração de dados existentes.
CREATE TABLE "church_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"issuer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	CONSTRAINT "church_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitation_role" CHECK ("church_invitations"."role" IN ('admin','collaborator')),
	CONSTRAINT "invitation_email" CHECK ("church_invitations"."email" = lower(trim("church_invitations"."email"))),
	CONSTRAINT "invitation_lifetime" CHECK ("church_invitations"."expires_at" > "church_invitations"."created_at"),
	CONSTRAINT "invitation_terminal" CHECK (("church_invitations"."accepted_at" IS NULL OR "church_invitations"."cancelled_at" IS NULL) AND (("church_invitations"."accepted_at" IS NULL) = ("church_invitations"."accepted_by" IS NULL)) AND (("church_invitations"."cancelled_at" IS NULL) = ("church_invitations"."cancelled_by" IS NULL)))
);

ALTER TABLE "church_invitations" ADD CONSTRAINT "church_invitations_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "church_invitations" ADD CONSTRAINT "church_invitations_issuer_id_user_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "church_invitations" ADD CONSTRAINT "church_invitations_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "church_invitations" ADD CONSTRAINT "church_invitations_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "church_invitation_page" ON "church_invitations" USING btree ("church_id","id");
CREATE INDEX "church_invitation_recipient" ON "church_invitations" USING btree ("church_id","email");
-- Mesma role operacional; não concede DELETE, DDL ou acesso a novas identidades.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='levi_dev_runtime') THEN
 GRANT SELECT, INSERT ON church_invitations TO levi_dev_runtime;
 GRANT UPDATE (accepted_at,accepted_by,cancelled_at,cancelled_by) ON church_invitations TO levi_dev_runtime;
 END IF;
END $$;
