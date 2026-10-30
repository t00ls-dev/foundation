import type { FeatureKey, FeaturePolicy } from "../feature-contracts.js";
import type { MemberProfile } from "../member-types.js";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  primaryKey,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const instant = (name: string) => timestamp(name, { withTimezone: true });

// Contadores técnicos efêmeros; chaves contêm HMAC, nunca IP/e-mail em claro.
export const abuseCounters = pgTable(
  "abuse_counters",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: instant("expires_at").notNull(),
  },
  (t) => [index("abuse_counters_expiry_idx").on(t.expiresAt)],
);

// Modelo público do Better Auth. IDs externos, tokens e valores não são UUIDs.
export const user = pgTable("user", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expiresAt: instant("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("account_provider_identity_unique").on(t.providerId, t.accountId),
    index("account_user_idx").on(t.userId),
  ],
);

export const verification = pgTable("verification", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull().unique(),
  value: text("value").notNull(),
  expiresAt: instant("expires_at").notNull(),
  createdAt: instant("created_at").defaultNow(),
  updatedAt: instant("updated_at").defaultNow(),
});

export const churches = pgTable(
  "churches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: integer("version").notNull().default(1),
    updatedAt: instant("updated_at").notNull().defaultNow(),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("church_name_nonempty", sql`length(trim(${t.name})) > 0`),
    check("churches_version_positive", sql`${t.version}>0`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actor: uuid("actor").notNull(),
    action: text("action").notNull(),
    target: uuid("target").notNull(),
    legacyOrganizationId: uuid("tenant"),
    churchId: uuid("church_id").references(() => churches.id),
    timestamp: instant("timestamp").notNull(),
    metadata: jsonb("metadata").notNull(),
    requestId: text("request_id"),
    result: text("result").notNull(),
  },
  (t) => [
    check("audit_metadata_minimal", sql`${t.metadata} = '{}'::jsonb`),
    check(
      "audit_scope",
      sql`(${t.churchId} IS NOT NULL AND ${t.legacyOrganizationId} IS NULL AND ${t.action} NOT IN ('admin.bootstrapped','admin.granted','admin.revoked','feature_flag.all','feature_flag.selected','feature_flag.disabled')) OR (${t.churchId} IS NULL AND ((${t.legacyOrganizationId} IS NULL) = (${t.action} IN (
        'admin.bootstrapped', 'admin.granted', 'admin.revoked',
        'feature_flag.all', 'feature_flag.selected', 'feature_flag.disabled'
      ))))`,
    ),
  ],
);

// Autoridade global do Levi; independente dos vínculos organizacionais.
export const globalAdministrators = pgTable(
  "global_administrators",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id),
    grantedAt: instant("granted_at").notNull().defaultNow(),
    grantedBy: uuid("granted_by"),
    revokedAt: instant("revoked_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    check("global_administrator_version_positive", sql`${t.version} > 0`),
  ],
);

// Sem FK/cascade para a identidade histórica: apagar conta não reabre bootstrap.
export const adminBootstrap = pgTable(
  "admin_bootstrap",
  {
    id: integer("id").primaryKey(),
    userId: uuid("bootstrapped_user_id").notNull(),
    completedAt: instant("completed_at").notNull().defaultNow(),
    operationId: uuid("operation_id").notNull(),
  },
  (t) => [check("admin_bootstrap_singleton", sql`${t.id} = 1`)],
);

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").$type<FeatureKey>().notNull().unique(),
    policy: text("policy").$type<FeaturePolicy["kind"]>().notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: instant("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").notNull(),
  },
  (t) => [
    check("feature_key_known", sql`${t.key} IN ('members')`),
    check(
      "feature_policy_known",
      sql`${t.policy} IN ('all', 'selected', 'disabled')`,
    ),
    check("feature_version_positive", sql`${t.version} > 0`),
  ],
);

// Entidades pessoais do Levi: não são contas de autenticação.
export const members = pgTable(
  "members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    churchId: uuid("church_id").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").$type<"Ativo" | "Inativo">().notNull(),
    birthDate: date("birth_date", { mode: "string" }),
    phone: text("phone"),
    email: text("email"),
    joinedOn: date("joined_on", { mode: "string" }),
    address: text("address"),
    baptismDate: date("baptism_date", { mode: "string" }),
    churchRole: text("church_role"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("members_church_identity").on(t.churchId, t.id),
    foreignKey({
      name: "members_church_root",
      columns: [t.churchId],
      foreignColumns: [churches.id],
    }),
    check("member_name_valid", sql`length(trim(${t.name})) BETWEEN 1 AND 160`),
    check("member_status_valid", sql`${t.status} IN ('Ativo', 'Inativo')`),
    index("members_church_order").on(t.churchId, t.name, t.id),
  ],
);

// Somente o fato inicial; ficha e histórico serão elimináveis em conjunto.
export const memberHistory = pgTable(
  "member_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    churchId: uuid("church_id").notNull(),
    memberId: uuid("member_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    churchName: text("church_name").notNull(),
    initialStatus: text("initial_status")
      .$type<"Ativo" | "Inativo">()
      .notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "history_church_member",
      columns: [t.churchId, t.memberId],
      foreignColumns: [members.churchId, members.id],
    }).onDelete("cascade"),
    unique("history_church_initial").on(t.churchId, t.memberId),
    check(
      "member_history_status_valid",
      sql`${t.initialStatus} IN ('Ativo', 'Inativo')`,
    ),
  ],
);

// Recibo eliminável com a ficha; nenhuma deduplicação por dado pessoal.
export const memberCreationRequests = pgTable(
  "member_creation_requests",
  {
    churchId: uuid("church_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    requestKey: text("request_key").notNull(),
    requestHash: text("request_hash").notNull(),
    memberId: uuid("member_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.actorId, t.requestKey] }),
    foreignKey({
      name: "receipt_church_member",
      columns: [t.churchId, t.memberId],
      foreignColumns: [members.churchId, members.id],
    }).onDelete("cascade"),
  ],
);

// Histórico pessoal eliminável por cascata, separado da auditoria técnica.
export const memberProfileHistory = pgTable(
  "member_profile_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    churchId: uuid("church_id").notNull(),
    memberId: uuid("member_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    version: integer("version").notNull(),
    previousProfile: jsonb("previous_profile").$type<MemberProfile>().notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "profile_church_member",
      columns: [t.churchId, t.memberId],
      foreignColumns: [members.churchId, members.id],
    }).onDelete("cascade"),
    unique("profile_church_version").on(t.churchId, t.memberId, t.version),
  ],
);

export const churchMemberships = pgTable(
  "church_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => churches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role").$type<"admin" | "collaborator">().notNull(),
    version: integer("version").notNull().default(1),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("church_membership_identity").on(t.churchId, t.userId),
    index("church_membership_user").on(t.userId, t.churchId),
    check("church_membership_role", sql`${t.role} IN ('admin','collaborator')`),
    check("church_membership_version", sql`${t.version} > 0`),
  ],
);
export const churchSessions = pgTable("church_sessions", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => session.id, { onDelete: "cascade" }),
  activeChurchId: uuid("active_church_id").references(() => churches.id),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});
export const churchCreationRequests = pgTable(
  "church_creation_requests",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    requestKey: text("request_key").notNull(),
    requestHash: text("request_hash").notNull(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => churches.id),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.requestKey] })],
);
export const featureFlagChurches = pgTable(
  "feature_flag_churches",
  {
    featureFlagId: uuid("feature_flag_id")
      .notNull()
      .references(() => featureFlags.id),
    churchId: uuid("church_id")
      .notNull()
      .references(() => churches.id),
  },
  (t) => [primaryKey({ columns: [t.featureFlagId, t.churchId] })],
);
