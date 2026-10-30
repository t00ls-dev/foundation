-- Somente após conversão; executar como owner/migrator, nunca pela runtime.
GRANT SELECT, INSERT ON church_memberships, church_sessions, church_creation_requests TO levi_dev_runtime;
GRANT UPDATE (role,version) ON church_memberships TO levi_dev_runtime;
GRANT UPDATE (active_church_id,updated_at) ON church_sessions TO levi_dev_runtime;
GRANT UPDATE (name,address,phone,email,version,updated_at) ON churches TO levi_dev_runtime;
GRANT SELECT (version,updated_at) ON churches TO levi_dev_runtime;
GRANT INSERT (church_id) ON member_history, member_creation_requests, member_profile_history, audit_events TO levi_dev_runtime;
GRANT SELECT (church_id) ON member_creation_requests TO levi_dev_runtime;
GRANT SELECT (feature_flag_id,church_id), INSERT (feature_flag_id,church_id) ON feature_flag_churches TO levi_dev_runtime;
GRANT DELETE ON feature_flag_churches TO levi_dev_runtime;
-- A versão nova não pode operar estruturas organizacionais nem excluir igreja/identidade.
REVOKE ALL ON tenants, tenant_memberships, tenant_sessions, onboarding_provisions, feature_flag_organizations FROM levi_dev_runtime;
REVOKE DELETE, TRUNCATE ON churches, church_memberships, church_creation_requests, "user" FROM levi_dev_runtime;
-- DELETE de vínculo é autorizado; TRUNCATE continua proibido.
GRANT DELETE ON church_memberships TO levi_dev_runtime;

REVOKE UPDATE (created_at) ON churches FROM levi_dev_runtime;
