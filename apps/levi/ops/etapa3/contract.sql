-- FORA do migrator automático. Somente após reconciliação e confirmação de escritores novos.
-- Retira o legado operacional depois da conversão; eventos anteriores permanecem intactos.
-- tenant da auditoria é UUID legado imutável; nenhuma atribuição a igreja é inferida.
LOCK TABLE churches, church_memberships, audit_events, members, member_history,
 member_creation_requests, member_profile_history IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM churches c WHERE NOT EXISTS (
 SELECT 1 FROM church_memberships m WHERE m.church_id=c.id AND m.role='admin')) THEN
 RAISE EXCEPTION 'Contract recusado: igreja sem administrador'; END IF;
END $$;
ALTER TABLE audit_events DROP CONSTRAINT audit_events_tenant_tenants_id_fk;
CREATE FUNCTION public.church_has_admin() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE cid uuid;
BEGIN
 IF TG_TABLE_NAME='churches' THEN cid:=NEW.id;
 ELSIF TG_OP='DELETE' THEN cid:=OLD.church_id;
 ELSE cid:=NEW.church_id; END IF;
 PERFORM 1 FROM public.churches WHERE id=cid FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.church_memberships WHERE church_id=cid AND role='admin') THEN
 RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Igreja exige administrador'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER church_admin_required AFTER INSERT ON churches
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.church_has_admin();
CREATE CONSTRAINT TRIGGER membership_admin_required AFTER INSERT OR UPDATE OR DELETE ON church_memberships
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.church_has_admin();
-- Serializa antes de alterar memberships, inclusive DML direto. Identidades imutáveis.
-- O UPDATE sem mudança de valor avança a versão MVCC da raiz: snapshots antigos
-- em REPEATABLE READ/SERIALIZABLE abortam, em vez de contar admins obsoletos.
CREATE FUNCTION public.lock_church_access() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.church_id<>OLD.church_id OR NEW.user_id<>OLD.user_id OR NEW.id<>OLD.id) THEN
 RAISE EXCEPTION 'Identidade de acesso imutável'; END IF;
 IF TG_OP='DELETE' THEN
 UPDATE public.churches SET updated_at=updated_at WHERE id=OLD.church_id; RETURN OLD;
 END IF;
 UPDATE public.churches SET updated_at=updated_at WHERE id=NEW.church_id; RETURN NEW;
END $$;
CREATE TRIGGER church_access_lock BEFORE INSERT OR UPDATE OR DELETE ON church_memberships
 FOR EACH ROW EXECUTE FUNCTION public.lock_church_access();
CREATE FUNCTION public.reject_legacy_audit() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.tenant IS NOT NULL THEN RAISE EXCEPTION 'Escopo legado fechado'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_no_new_legacy BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_legacy_audit();
-- Retirada física somente nesta fase. Auditoria mantém o UUID tenant legado sem FK.
-- Arquivo imutável sem autoridade operacional: preserva inclusive IDs de vínculos,
-- organizações vazias e recibos antigos. A aplicação não tem reader nem grants.
CREATE SCHEMA levi_legacy;
REVOKE ALL ON SCHEMA levi_legacy FROM PUBLIC;
CREATE TABLE levi_legacy.church_organizations AS SELECT id AS church_id,tenant_id AS organization_id FROM churches WHERE tenant_id IS NOT NULL;
ALTER TABLE onboarding_provisions DROP CONSTRAINT onboarding_church_same_tenant;
ALTER TABLE onboarding_provisions DROP CONSTRAINT onboarding_provisions_user_id_user_id_fk;
ALTER TABLE tenant_memberships DROP CONSTRAINT tenant_memberships_user_id_user_id_fk;
ALTER TABLE tenant_sessions DROP CONSTRAINT tenant_sessions_session_id_session_id_fk;
ALTER TABLE feature_flag_organizations DROP CONSTRAINT feature_flag_organizations_feature_flag_id_feature_flags_id_fk;
ALTER TABLE onboarding_provisions SET SCHEMA levi_legacy;
ALTER TABLE tenant_sessions SET SCHEMA levi_legacy;
ALTER TABLE feature_flag_organizations SET SCHEMA levi_legacy;
ALTER TABLE tenant_memberships SET SCHEMA levi_legacy;
ALTER TABLE member_history DROP CONSTRAINT member_history_same_tenant;
ALTER TABLE member_profile_history DROP CONSTRAINT member_profile_history_same_tenant;
ALTER TABLE member_creation_requests DROP CONSTRAINT member_request_same_tenant;
ALTER TABLE members DROP CONSTRAINT member_church_same_tenant;
ALTER TABLE member_history DROP COLUMN tenant_id;
ALTER TABLE member_profile_history DROP COLUMN tenant_id;
ALTER TABLE member_creation_requests DROP COLUMN tenant_id;
ALTER TABLE members DROP COLUMN tenant_id;
ALTER TABLE churches DROP COLUMN tenant_id;
ALTER TABLE tenants SET SCHEMA levi_legacy;
CREATE TRIGGER legacy_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON levi_legacy.tenants FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER legacy_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON levi_legacy.tenant_memberships FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER legacy_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON levi_legacy.tenant_sessions FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER legacy_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON levi_legacy.onboarding_provisions FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER legacy_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON levi_legacy.feature_flag_organizations FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER legacy_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON levi_legacy.church_organizations FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
REVOKE ALL ON FUNCTION public.church_has_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_church_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_legacy_audit() FROM PUBLIC;
