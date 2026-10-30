-- Operação separada do journal. Executar com escritores drenados, em transação.
-- O lock de todas as relações impede mudanças entre conversão e reconciliação.
LOCK TABLE churches, tenant_memberships, tenant_sessions, members, member_history,
 member_creation_requests, member_profile_history, feature_flags, feature_flag_organizations,
 church_memberships, church_sessions, feature_flag_churches IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM tenant_memberships WHERE role <> 'admin') THEN
 RAISE EXCEPTION 'Papéis legados desconhecidos: resolver sem conceder acesso'; END IF;
 IF EXISTS (SELECT 1 FROM churches c WHERE c.tenant_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tenant_memberships m JOIN "user" u ON u.id=m.user_id
 WHERE m.tenant_id=c.tenant_id AND m.role='admin')) THEN
 RAISE EXCEPTION 'Igreja legada sem administrador'; END IF;
END $$;
INSERT INTO church_memberships(church_id,user_id,role,created_at)
 SELECT c.id,m.user_id,'admin',m.created_at FROM churches c JOIN tenant_memberships m ON m.tenant_id=c.tenant_id
 WHERE m.role='admin' ON CONFLICT(church_id,user_id) DO NOTHING;
DO $$ BEGIN
 IF EXISTS ((SELECT m.user_id,c.id FROM tenant_memberships m JOIN churches c ON c.tenant_id=m.tenant_id WHERE m.role='admin'
 EXCEPT SELECT user_id,church_id FROM church_memberships WHERE role='admin') UNION ALL
 (SELECT user_id,church_id FROM church_memberships WHERE role='admin' EXCEPT
 SELECT m.user_id,c.id FROM tenant_memberships m JOIN churches c ON c.tenant_id=m.tenant_id WHERE m.role='admin')) THEN
 RAISE EXCEPTION 'Conjunto administrativo divergente'; END IF;
END $$;
INSERT INTO church_sessions(session_id,active_church_id)
 SELECT s.session_id,min(c.id::text)::uuid FROM tenant_sessions s
 JOIN session auth ON auth.id=s.session_id
 JOIN churches c ON c.tenant_id=s.active_tenant_id
 JOIN church_memberships m ON m.church_id=c.id AND m.user_id=auth.user_id
 GROUP BY s.session_id HAVING count(*)=1 ON CONFLICT DO NOTHING;
UPDATE member_history h SET church_id=m.church_id FROM members m WHERE m.id=h.member_id AND m.tenant_id=h.tenant_id AND h.church_id IS NULL;
UPDATE member_profile_history h SET church_id=m.church_id FROM members m WHERE m.id=h.member_id AND m.tenant_id=h.tenant_id AND h.church_id IS NULL;
UPDATE member_creation_requests h SET church_id=m.church_id FROM members m WHERE m.id=h.member_id AND m.tenant_id=h.tenant_id AND h.church_id IS NULL;
INSERT INTO feature_flag_churches SELECT f.feature_flag_id,c.id FROM feature_flag_organizations f JOIN churches c ON c.tenant_id=f.organization_id ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF EXISTS ((SELECT f.feature_flag_id,c.id FROM feature_flag_organizations f JOIN churches c ON c.tenant_id=f.organization_id
 EXCEPT SELECT feature_flag_id,church_id FROM feature_flag_churches) UNION ALL
 (SELECT feature_flag_id,church_id FROM feature_flag_churches EXCEPT
 SELECT f.feature_flag_id,c.id FROM feature_flag_organizations f JOIN churches c ON c.tenant_id=f.organization_id)) THEN
 RAISE EXCEPTION 'Seleção de flags divergente'; END IF;
END $$;
ALTER TABLE churches ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE members ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE member_history ALTER COLUMN tenant_id DROP NOT NULL, ALTER COLUMN church_id SET NOT NULL;
ALTER TABLE member_profile_history ALTER COLUMN tenant_id DROP NOT NULL, ALTER COLUMN church_id SET NOT NULL;
ALTER TABLE member_creation_requests DROP CONSTRAINT IF EXISTS member_creation_requests_tenant_id_actor_id_request_key_pk;
ALTER TABLE member_creation_requests ALTER COLUMN tenant_id DROP NOT NULL, ALTER COLUMN church_id SET NOT NULL;
ALTER TABLE member_creation_requests DROP CONSTRAINT IF EXISTS member_creation_requests_pkey;
ALTER TABLE member_creation_requests ADD PRIMARY KEY(church_id,actor_id,request_key);
DROP TRIGGER IF EXISTS churches_reject_dev_runtime_update ON churches;
