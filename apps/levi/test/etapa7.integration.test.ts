import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readFile,
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hashPassword } from "better-auth/crypto";
import {
  localTestDatabaseUrl,
  applyRuntimeGrants,
} from "./runtime-acl-fixture.js";
import { workerHarness, workerOrigin, cookieFrom } from "./worker-harness.js";
import { maintenanceSmokeHeaders } from "../tools/deploy-config.js";
import {
  guardedRead,
  verifyCheckpoint,
  capturePreservation,
  preservationDifferences,
} from "../tools/etapa7-verification.js";
import type { Checkpoint, Preservation } from "../tools/etapa7-verification.js";

const observerUrl = process.env.LEVI_DATABASE_URL ?? "";
const migratorUrl = process.env.LEVI_TEST_MIGRATOR_DATABASE_URL ?? "";
const runtimeUrl = process.env.LEVI_TEST_RUNTIME_DATABASE_URL ?? "";
for (const [url, role] of [
  [observerUrl, "levi_test"],
  [migratorUrl, "levi_dev_migrator"],
  [runtimeUrl, "levi_dev_runtime"],
])
  localTestDatabaseUrl(url ?? "", role ?? "");
assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.env.LEVI_LOCAL_DATABASE, "1");

void test("etapa 7: legado → expansões → conversão/ACLs → smokes restritos → contract, sem recursos externos", async () => {
  const owner = await createPostgresDatabase(migratorUrl);
  const observer = await createPostgresDatabase(observerUrl);
  const runtime = await createPostgresDatabase(runtimeUrl);
  const identity = {
    database: "levi_test",
    role: "levi_dev_migrator",
    project: null,
    branch: null,
    endpoint: null,
  };
  let baseline: Preservation | undefined;
  async function checkpoint(phase: Checkpoint) {
    const fresh = await createPostgresDatabase(migratorUrl);
    try {
      await guardedRead(fresh.client, identity);
      const result = await verifyCheckpoint(fresh.client, phase);
      const snapshot = await capturePreservation(fresh.client, phase);
      if (baseline)
        assert.ok(
          preservationDifferences(baseline, snapshot).every(
            (r) => r.differences === 0,
          ),
        );
      else baseline = snapshot;
      // O payload de evidência não inclui os valores comparados em memória.
      assert.ok(!JSON.stringify(result).includes("synthetic-private-"));
    } finally {
      await fresh.client.query("ROLLBACK");
      await fresh.client.end();
    }
  }
  async function through(count: number) {
    const folder = await mkdtemp(join(tmpdir(), "levi-etapa7-"));
    try {
      const journal: unknown = JSON.parse(
        await readFile("migrations/meta/_journal.json", "utf8"),
      );
      assert.ok(
        journal &&
          typeof journal === "object" &&
          "entries" in journal &&
          Array.isArray(journal.entries),
      );
      const entries: unknown[] = journal.entries.slice(0, count);
      await mkdir(join(folder, "meta"));
      await writeFile(
        join(folder, "meta/_journal.json"),
        JSON.stringify({ ...journal, entries }),
      );
      for (const entry of entries) {
        assert.ok(
          entry &&
            typeof entry === "object" &&
            "tag" in entry &&
            typeof entry.tag === "string",
        );
        assert.match(entry.tag, /^\d{4}_[a-z0-9_-]+$/);
        await copyFile(
          `migrations/${entry.tag}.sql`,
          join(folder, `${entry.tag}.sql`),
        );
      }
      await migrate(owner.db, { migrationsFolder: folder });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
  async function operation(name: string) {
    await owner.client.query("BEGIN");
    try {
      await owner.client.query(
        await readFile(
          new URL(`../ops/etapa3/${name}.sql`, import.meta.url),
          "utf8",
        ),
      );
      await owner.client.query("COMMIT");
    } catch (error) {
      await owner.client.query("ROLLBACK");
      throw error;
    }
  }
  try {
    await through(7);
    await applyRuntimeGrants(migratorUrl);
    const uid = randomUUID(),
      sid = randomUUID(),
      tid = randomUUID(),
      cid = randomUUID(),
      mid = randomUUID();
    const password = "synthetic-etapa7-password";
    await owner.client.query(
      `INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,'synthetic-private-name','synthetic-private-user@example.test',true,now(),now())`,
      [uid],
    );
    await owner.client.query(
      `INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES($1,$2::text,'credential',$2::uuid,$3,now(),now())`,
      [randomUUID(), uid, await hashPassword(password)],
    );
    await owner.client.query(
      `INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) VALUES($1,$2,'synthetic-private-token',now()+interval '1 day',now(),now())`,
      [sid, uid],
    );
    await owner.client.query(
      "INSERT INTO tenants(id,name) VALUES($1,'Sintética')",
      [tid],
    );
    await owner.client.query(
      "INSERT INTO churches(id,tenant_id,name) VALUES($1,$2,'Sintética')",
      [cid, tid],
    );
    await owner.client.query(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [tid, uid],
    );
    await owner.client.query(
      "INSERT INTO tenant_sessions(session_id,active_tenant_id) VALUES($1,$2)",
      [sid, tid],
    );
    await owner.client.query(
      "INSERT INTO members(id,tenant_id,church_id,name,status) VALUES($1,$2,$3,'synthetic-private-member','Ativo')",
      [mid, tid, cid],
    );
    await owner.client.query(
      "INSERT INTO member_history(tenant_id,member_id,actor_id,church_name,initial_status) VALUES($1,$2,$3,'Sintética','Ativo')",
      [tid, mid, uid],
    );
    await owner.client.query(
      "INSERT INTO member_creation_requests(tenant_id,actor_id,request_key,request_hash,member_id) VALUES($1,$2,'synthetic-private-key','synthetic-private-hash',$3)",
      [tid, uid, mid],
    );
    await owner.client.query(
      "INSERT INTO audit_events(actor,target,tenant,action,timestamp,metadata,result) VALUES($1,$2,$3,'member.created',now(),'{}','success')",
      [uid, mid, tid],
    );
    await checkpoint("baseline");
    await through(8);
    await checkpoint("expand7");
    await through(9);
    await checkpoint("expand8");
    // Erro transacional: nada parcialmente convertido deve sobreviver.
    await owner.client.query("BEGIN");
    await owner.client.query(
      await readFile("ops/etapa3/converter.sql", "utf8"),
    );
    await assert.rejects(owner.client.query("SELECT 1/0"));
    await owner.client.query("ROLLBACK");
    assert.equal(
      (
        await owner.client.query<{ n: number }>(
          "SELECT count(*)::int n FROM church_memberships",
        )
      ).rows[0]?.n,
      0,
    );
    await operation("converter");
    await operation("runtime-acls");
    await checkpoint("converted");
    // Igualdade de totais não oculta mudança de payload; evidência só contém indicadores.
    await owner.client.query("BEGIN");
    await owner.client.query(
      `UPDATE public."user" SET name='synthetic-private-changed' WHERE id=$1`,
      [uid],
    );
    assert.ok(baseline);
    const changed = preservationDifferences(
      baseline,
      await capturePreservation(owner.client, "converted"),
    );
    assert.equal(changed.find((r) => r.table === "user")?.differences, 1);
    assert.ok(!JSON.stringify(changed).includes("synthetic-private-"));
    await owner.client.query("ROLLBACK");
    // Grant de tabela não pode mascarar a lista restrita de colunas.
    await owner.client.query(
      "GRANT UPDATE ON public.churches TO levi_dev_runtime",
    );
    await assert.rejects(checkpoint("converted"), /columns_churches_UPDATE/);
    await owner.client.query(
      "REVOKE UPDATE ON public.churches FROM levi_dev_runtime",
    );
    await operation("runtime-acls");
    await checkpoint("converted");

    // Identidade incorreta aborta antes de consultar dados; READ ONLY rejeita escrita.
    await guardedRead(owner.client, identity);
    await assert.rejects(
      owner.client.query("UPDATE churches SET name='indevido'"),
      { code: "25006" },
    );
    await owner.client.query("ROLLBACK");
    await assert.rejects(
      guardedRead(owner.client, { ...identity, branch: "wrong-branch" }),
      /identidade SQL/,
    );
    await owner.client.query("ROLLBACK");
    // Demonstra que ausência momentânea de backends não é término de request:
    // trabalho pendente pode abrir uma conexão depois da amostra.
    const activityBefore = await observer.client.query<{ n: number }>(
      "SELECT count(*)::int n FROM pg_stat_activity WHERE usename='levi_dev_runtime'",
    );
    await runtime.client.end();
    let resume: () => void = () => {
      throw new Error("Continuação não preparada");
    };
    const delayed = new Promise<void>((resolve) => {
      resume = resolve;
    }).then(async () => {
      const late = await createPostgresDatabase(runtimeUrl);
      try {
        return (await late.client.query<{ n: number }>("SELECT 1 AS n")).rows[0]
          ?.n;
      } finally {
        await late.client.end();
      }
    });
    assert.ok((activityBefore.rows[0]?.n ?? 0) >= 1);
    assert.equal(
      (
        await observer.client.query<{ n: number }>(
          "SELECT count(*)::int n FROM pg_stat_activity WHERE usename='levi_dev_runtime'",
        )
      ).rows[0]?.n,
      0,
    );
    resume();
    assert.equal(await delayed, 1);

    const harness = await workerHarness(observerUrl);
    try {
      const capability = "f".repeat(64);
      const headers = maintenanceSmokeHeaders({
        LEVI_MAINTENANCE_SMOKE: "true",
        LEVI_SMOKE_CAPABILITY: capability,
      });
      const paths = [
        "/",
        "/admin",
        "/api/admin/session",
        "/api/onboarding",
        "/api/churches",
        "/api/members",
      ];
      let dispatched = 0;
      // Modelo sintético da regra M1: não é prova de WAF remoto.
      async function restricted(url: string, init: RequestInit = {}) {
        const target = new URL(url);
        const requestHeaders = new Headers(init.headers);
        if (
          target.origin !== workerOrigin ||
          target.search ||
          !paths.includes(target.pathname) ||
          (init.method ?? "GET") !== "GET" ||
          requestHeaders.has("cookie") ||
          requestHeaders.has("authorization") ||
          requestHeaders.get("X-Levi-Smoke-Capability") !== capability
        )
          return new Response(null, { status: 403 });
        dispatched++;
        return harness.mf.dispatchFetch(url, {
          method: "GET",
          redirect: "manual",
          headers: { ...headers, "cf-connecting-ip": "192.0.2.7" },
        });
      }
      for (const path of paths) {
        const response = await restricted(workerOrigin + path, {
          headers,
          redirect: "manual",
        });
        assert.equal(
          response.status,
          path === "/" || path === "/api/onboarding"
            ? 200
            : path.startsWith("/admin") || path === "/api/admin/session"
              ? 404
              : 401,
        );
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
        assert.ok(response.headers.get("content-security-policy"));
        if (path.includes("admin"))
          assert.ok(
            response.headers.get("cache-control")?.includes("no-store"),
          );
        if (path === "/")
          assert.ok(
            response.headers.get("content-type")?.includes("text/html"),
          );
        if (path === "/api/onboarding")
          assert.deepEqual(await response.json(), { etapa: "email" });
        else await response.arrayBuffer();
      }
      for (const [path, init] of [
        ["/api/onboarding/email", { method: "POST", headers }],
        ["/api/auth/sign-in/email", { headers }],
        ["/api/context", { headers }],
        ["/?q=1", { headers }],
        ["/api/churches", { method: "POST", headers }],
        ["/", {}],
        ["/", { headers: { ...headers, Cookie: "synthetic" } }],
        ["/", { headers: { ...headers, Authorization: "Bearer synthetic" } }],
      ] satisfies [string, RequestInit][])
        assert.equal((await restricted(workerOrigin + path, init)).status, 403);
      assert.equal(dispatched, 6);
      await checkpoint("converted");
      // Reconcilia commit em conexão nova; não simula falha de rede no ACK.
      await operation("contract");
      await checkpoint("contracted");
      const login = await harness.send("/api/auth/sign-in/email", {
        email: "synthetic-private-user@example.test",
        password,
      });
      assert.equal(login.status, 200);
      const cookie = cookieFrom(login);
      assert.ok(cookie);
      assert.equal(
        (await harness.send("/api/context/church", { churchId: cid }, cookie))
          .status,
        200,
      );
      const context = await harness.send("/api/context", undefined, cookie);
      assert.equal(context.status, 200);
      const creation = await harness.send(
        "/api/churches",
        { name: "Após contract" },
        cookie,
        { "Idempotency-Key": randomUUID() },
      );
      assert.equal(creation.status, 201);
      const restrictedRuntime = await createPostgresDatabase(runtimeUrl);
      try {
        for (const sql of [
          "DELETE FROM churches",
          "TRUNCATE church_memberships",
          "SELECT * FROM levi_legacy.tenants",
          "DELETE FROM church_invitations",
        ])
          await assert.rejects(restrictedRuntime.client.query(sql), {
            code: "42501",
          });
        await assert.rejects(
          restrictedRuntime.client.query(
            "DELETE FROM church_memberships WHERE church_id=$1",
            [cid],
          ),
          /administrador/,
        );
      } finally {
        await restrictedRuntime.client.end();
      }
    } finally {
      await harness.mf.dispose();
    }
  } finally {
    await runtime.client.end();
    await owner.client.end();
    await observer.client.end();
    baseline?.clear();
  }
});
