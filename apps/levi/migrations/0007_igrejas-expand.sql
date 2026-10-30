-- Expansão compatível: nenhum backfill, remoção ou mudança de escrita legada.
ALTER TABLE churches ADD COLUMN version integer NOT NULL DEFAULT 1 CONSTRAINT churches_version_positive CHECK (version > 0),
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE church_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 church_id uuid NOT NULL CONSTRAINT church_memberships_church_id_churches_id_fk REFERENCES churches(id),
 user_id uuid NOT NULL CONSTRAINT church_memberships_user_id_user_id_fk REFERENCES "user"(id),
 role text NOT NULL CONSTRAINT church_membership_role CHECK(role IN ('admin','collaborator')),
 version integer NOT NULL DEFAULT 1 CONSTRAINT church_membership_version CHECK(version > 0),
 created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT church_membership_identity UNIQUE(church_id,user_id)
);
CREATE INDEX church_membership_user ON church_memberships(user_id,church_id);
CREATE TABLE church_sessions (
 session_id uuid PRIMARY KEY CONSTRAINT church_sessions_session_id_session_id_fk REFERENCES session(id) ON DELETE CASCADE,
 active_church_id uuid CONSTRAINT church_sessions_active_church_id_churches_id_fk REFERENCES churches(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE church_creation_requests (
 user_id uuid NOT NULL CONSTRAINT church_creation_requests_user_id_user_id_fk REFERENCES "user"(id), request_key text NOT NULL,
 request_hash text NOT NULL, church_id uuid NOT NULL CONSTRAINT church_creation_requests_church_id_churches_id_fk REFERENCES churches(id),
 created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT church_creation_requests_user_id_request_key_pk PRIMARY KEY(user_id,request_key)
);
CREATE TABLE feature_flag_churches (
 feature_flag_id uuid NOT NULL CONSTRAINT feature_flag_churches_feature_flag_id_feature_flags_id_fk REFERENCES feature_flags(id),
 church_id uuid NOT NULL CONSTRAINT feature_flag_churches_church_id_churches_id_fk REFERENCES churches(id), CONSTRAINT feature_flag_churches_feature_flag_id_church_id_pk PRIMARY KEY(feature_flag_id,church_id)
);
ALTER TABLE audit_events ADD COLUMN church_id uuid CONSTRAINT audit_events_church_id_churches_id_fk REFERENCES churches(id);
ALTER TABLE audit_events DROP CONSTRAINT audit_global_scope;
ALTER TABLE audit_events ADD CONSTRAINT audit_scope CHECK (
 (church_id IS NOT NULL AND tenant IS NULL AND action NOT IN (
 'admin.bootstrapped','admin.granted','admin.revoked',
 'feature_flag.all','feature_flag.selected','feature_flag.disabled')) OR
 (church_id IS NULL AND ((tenant IS NULL) = (action IN (
 'admin.bootstrapped','admin.granted','admin.revoked',
 'feature_flag.all','feature_flag.selected','feature_flag.disabled')))));
ALTER TABLE members ADD CONSTRAINT members_church_identity UNIQUE(church_id,id);
ALTER TABLE member_history ADD COLUMN church_id uuid;
ALTER TABLE member_creation_requests ADD COLUMN church_id uuid;
ALTER TABLE member_profile_history ADD COLUMN church_id uuid;
ALTER TABLE member_history ADD CONSTRAINT history_church_member FOREIGN KEY(church_id,member_id) REFERENCES members(church_id,id) ON DELETE CASCADE;
ALTER TABLE member_creation_requests ADD CONSTRAINT receipt_church_member FOREIGN KEY(church_id,member_id) REFERENCES members(church_id,id) ON DELETE CASCADE;
ALTER TABLE member_profile_history ADD CONSTRAINT profile_church_member FOREIGN KEY(church_id,member_id) REFERENCES members(church_id,id) ON DELETE CASCADE;
CREATE INDEX members_church_order ON members(church_id,name,id);
ALTER TABLE member_history ADD CONSTRAINT history_church_initial UNIQUE(church_id,member_id);
ALTER TABLE member_profile_history ADD CONSTRAINT profile_church_version UNIQUE(church_id,member_id,version);
CREATE UNIQUE INDEX receipt_church_key ON member_creation_requests(church_id,actor_id,request_key);
ALTER TABLE members ADD CONSTRAINT members_church_root FOREIGN KEY(church_id) REFERENCES churches(id);
