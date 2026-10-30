-- Executado exclusivamente dentro de REPEATABLE READ READ ONLY, após guarda de identidade.
-- Não retorna query text, IPs, senhas, tokens ou dados de aplicação.
SELECT jsonb_build_object(
 'observed_at',clock_timestamp(),
 'runtime', (SELECT to_jsonb(r) - 'oid' FROM (
   SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolconnlimit
   FROM pg_roles WHERE rolname='levi_dev_runtime') r),
 'operator', (SELECT to_jsonb(r) FROM (
   SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname=current_user) r),
 'memberships', (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'role', parent.rolname, 'member', child.rolname, 'admin', m.admin_option,
   'inherit', m.inherit_option, 'set', m.set_option)), '[]'::jsonb)
   FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
   JOIN pg_roles child ON child.oid=m.member
   WHERE child.rolname IN (current_user,'levi_dev_runtime') OR parent.rolname='levi_dev_runtime'),
 'signal_member', pg_has_role(current_user,'pg_signal_backend','MEMBER'),
 'signal_inherited', pg_has_role(current_user,'pg_signal_backend','USAGE'),
 'runtime_backends', (SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM (
   SELECT pid,backend_start,datname,state,xact_start,wait_event_type
   FROM pg_stat_activity WHERE usename='levi_dev_runtime' AND pid<>pg_backend_pid()) a),
 'activity', (SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM (
   SELECT datname, usename, state, count(*) AS backends,
     count(*) FILTER (WHERE xact_start IS NOT NULL) AS transactions
   FROM pg_stat_activity WHERE pid<>pg_backend_pid()
     AND (datname=current_database() OR usename='levi_dev_runtime')
   GROUP BY datname,usename,state) a),
 'locks', (SELECT count(*) FROM pg_locks WHERE pid<>pg_backend_pid()
   AND database=(SELECT oid FROM pg_database WHERE datname=current_database())),
 'prepared_transactions', (SELECT count(*) FROM pg_prepared_xacts),
 'database_create', has_database_privilege('levi_dev_runtime',current_database(),'CREATE'),
 'database_temp', has_database_privilege('levi_dev_runtime',current_database(),'TEMP'),
 'schemas', (SELECT jsonb_agg(jsonb_build_object('schema',nspname,
   'usage',has_schema_privilege('levi_dev_runtime',oid,'USAGE'),
   'create',has_schema_privilege('levi_dev_runtime',oid,'CREATE'),'acl',nspacl))
   FROM pg_namespace WHERE nspname IN ('public','levi_legacy','drizzle')),
 'relations', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
   'owner',pg_get_userbyid(c.relowner), 'acl',c.relacl, 'privileges', (
     SELECT jsonb_object_agg(p,has_table_privilege('levi_dev_runtime',c.oid,p))
     FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p)))
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','levi_legacy','drizzle') AND c.relkind IN ('r','p','v','m')),
 'columns', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'acl',a.attacl,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
   'default',(SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=c.oid AND d.adnum=a.attnum),
   'privileges',(SELECT jsonb_object_agg(p,has_column_privilege('levi_dev_runtime',c.oid,a.attnum,p))
   FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p)))
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','levi_legacy','drizzle') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped),
 'sequences', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'acl',c.relacl,
   'usage',has_sequence_privilege('levi_dev_runtime',c.oid,'USAGE'),
   'select',has_sequence_privilege('levi_dev_runtime',c.oid,'SELECT'),
   'update',has_sequence_privilege('levi_dev_runtime',c.oid,'UPDATE'))),'[]'::jsonb)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','levi_legacy','drizzle') AND c.relkind='S'),
 'functions', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
   'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'security_definer',p.prosecdef,'config',p.proconfig,
   'runtime_execute',has_function_privilege('levi_dev_runtime',p.oid,'EXECUTE'),
   'public_execute',EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
     WHERE x.grantee=0 AND x.privilege_type='EXECUTE'))),'[]'::jsonb)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
 'default_acls', (SELECT coalesce(jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),
   'schema',n.nspname,'type',d.defaclobjtype,'grantee',coalesce(r.rolname,'PUBLIC'),
   'privilege',x.privilege_type,'grantable',x.is_grantable)),'[]'::jsonb)
   FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
   CROSS JOIN LATERAL aclexplode(d.defaclacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee),
 'public_and_grant_options', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',table_schema,
   'table',table_name,'grantee',grantee,'privilege',privilege_type,'grantable',is_grantable)),'[]'::jsonb)
   FROM information_schema.table_privileges WHERE table_schema IN ('public','levi_legacy','drizzle')
     AND (grantee='PUBLIC' OR (grantee='levi_dev_runtime' AND is_grantable='YES'))),
 'column_grant_options', (SELECT count(*) FROM information_schema.column_privileges
   WHERE table_schema IN ('public','levi_legacy','drizzle') AND grantee='levi_dev_runtime' AND is_grantable='YES'),
 'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
   'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid))),'[]'::jsonb)
   FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','levi_legacy','drizzle')),
 'indexes', (SELECT jsonb_agg(jsonb_build_object('name',i.relname,'valid',x.indisvalid,'ready',x.indisready,'definition',pg_get_indexdef(x.indexrelid)))
   FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=i.relnamespace
   WHERE n.nspname IN ('public','levi_legacy','drizzle')),
 'triggers', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
   'name',t.tgname,'enabled',t.tgenabled,'deferred',t.tginitdeferred))
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','levi_legacy','drizzle') AND NOT t.tgisinternal)
) AS catalog;
