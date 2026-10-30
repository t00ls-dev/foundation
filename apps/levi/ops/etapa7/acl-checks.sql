-- Fases converted/contracted; negações efetivas incluem grants de tabela e PUBLIC.
WITH relations AS (
 SELECT c.oid,c.relname,c.relowner,n.nspname FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','levi_legacy','drizzle') AND c.relkind IN ('r','p')
), forbidden AS (
 SELECT 'ddl_truncate' AS "check", count(*)::int AS differences FROM relations c
 WHERE EXISTS (SELECT 1 FROM unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
   WHERE has_table_privilege('levi_dev_runtime',c.oid,p))
 UNION ALL SELECT 'ownership',count(*)::int FROM relations WHERE relowner='levi_dev_runtime'::regrole
 UNION ALL SELECT 'legacy_access',count(*)::int FROM relations c WHERE
 (nspname IN ('levi_legacy','drizzle') OR relname IN ('tenants','tenant_memberships','tenant_sessions','onboarding_provisions','feature_flag_organizations'))
 AND (EXISTS(SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE has_table_privilege('levi_dev_runtime',c.oid,p))
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p WHERE has_any_column_privilege('levi_dev_runtime',c.oid,p)))
 UNION ALL SELECT 'delete',count(*)::int FROM relations c
 WHERE has_table_privilege('levi_dev_runtime',c.oid,'DELETE')
 AND relname NOT IN ('account','session','verification','abuse_counters','church_memberships','feature_flag_churches')
 UNION ALL SELECT 'database_ddl',count(*)::int FROM pg_database WHERE datname=current_database()
 AND (has_database_privilege('levi_dev_runtime',oid,'CREATE') OR has_database_privilege('levi_dev_runtime',oid,'TEMP') OR datdba='levi_dev_runtime'::regrole)
 UNION ALL SELECT 'schema_ddl',count(*)::int FROM pg_namespace WHERE nspname IN ('public','levi_legacy','drizzle')
 AND (has_schema_privilege('levi_dev_runtime',oid,'CREATE') OR nspowner='levi_dev_runtime'::regrole)
 UNION ALL SELECT 'role_attributes',count(*)::int FROM pg_roles WHERE rolname='levi_dev_runtime'
 AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
 UNION ALL SELECT 'runtime_memberships',count(*)::int FROM pg_auth_members WHERE member='levi_dev_runtime'::regrole
 UNION ALL SELECT 'column_grant_option',count(*)::int FROM information_schema.column_privileges
 WHERE grantee='levi_dev_runtime' AND table_schema IN ('public','levi_legacy') AND is_grantable='YES'
 UNION ALL SELECT 'public_table_grants',count(*)::int FROM information_schema.table_privileges
 WHERE grantee='PUBLIC' AND table_schema IN ('public','levi_legacy')
 UNION ALL SELECT 'functions',count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.prosecdef OR has_function_privilege('levi_dev_runtime',p.oid,'EXECUTE'))
), expected_columns(table_name,privilege,columns) AS (VALUES
 ('church_memberships','UPDATE',ARRAY['role','version']),
 ('church_sessions','UPDATE',ARRAY['active_church_id','updated_at']),
 ('churches','UPDATE',ARRAY['name','address','phone','email','version','updated_at']),
 ('church_invitations','UPDATE',ARRAY['accepted_at','accepted_by','cancelled_at','cancelled_by']),
 ('audit_events','UPDATE',ARRAY[]::text[]),
 ('audit_events','SELECT',ARRAY[]::text[]),
 ('member_history','UPDATE',ARRAY[]::text[]),
 ('member_profile_history','SELECT',ARRAY[]::text[]),
 ('member_profile_history','UPDATE',ARRAY[]::text[])
), columns_check AS (
 SELECT 'columns_'||e.table_name||'_'||e.privilege AS "check",count(*)::int AS differences
 FROM expected_columns e JOIN pg_class c ON c.relname=e.table_name
 JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE has_column_privilege('levi_dev_runtime',c.oid,a.attnum,e.privilege) <> (a.attname=ANY(e.columns))
 GROUP BY e.table_name,e.privilege
), required AS (
 SELECT 'required_new_grants' AS "check",count(*)::int AS differences
 FROM unnest(ARRAY['church_memberships','church_sessions','church_creation_requests','church_invitations','feature_flag_churches']) t
 JOIN pg_class c ON c.relname=t
 JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 CROSS JOIN unnest(ARRAY['SELECT','INSERT']) p
 WHERE NOT has_column_privilege('levi_dev_runtime',c.oid,a.attnum,p)
)
SELECT * FROM forbidden UNION ALL SELECT * FROM columns_check UNION ALL SELECT * FROM required ORDER BY "check";
