import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{40}$/;
const hex = /^[a-f0-9]{32}$/;
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Não importa o publicador, banco, Wrangler ou dependências do aplicativo.
// Os dados remotos só saem por projeções fechadas; nunca imprimir erros ou payloads.
export async function diagnoseCloudflare(env, fetcher = globalThis.fetch) {
  const report = {
    credential: "foundation/levi-dev/CLOUDFLARE_API_TOKEN",
    ok: false,
    checks: [],
  };
  try {
    assert.equal(env.GITHUB_ACTIONS, "true");
    assert.equal(env.GITHUB_REPOSITORY, "t00ls-dev/foundation");
    assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
    assert.equal(env.GITHUB_REF, "refs/heads/master");
    assert.match(env.GITHUB_SHA ?? "", sha);
    assert.equal(env.LEVI_DIAGNOSTIC_SHA, env.GITHUB_SHA);
    for (const name of [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_ZONE_ID",
      "LEVI_HYPERDRIVE_ID",
    ])
      assert.match(env[name] ?? "", hex);
    assert.ok(
      typeof env.CLOUDFLARE_API_TOKEN === "string" &&
        /^[\x21-\x7e]{40,80}$/.test(env.CLOUDFLARE_API_TOKEN),
    );
    assert.match(
      env.LEVI_DEV_DATABASE_HOST ?? "",
      /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/,
    );
    assert.match(
      env.LEVI_DEV_DATABASE_NAME ?? "",
      /^levi_dev(?:_[a-z0-9_]+)?$/,
    );
  } catch {
    report.checks.push({
      check: "configuration",
      outcome: "invalid_configuration",
    });
    return report;
  }
  const privateValues = [env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ACCOUNT_ID];
  function identifier(value, pattern) {
    return typeof value === "string" &&
      pattern.test(value) &&
      privateValues.every((secret) => !value.includes(secret))
      ? value
      : null;
  }
  report.commit = identifier(env.GITHUB_SHA, sha);
  report.tokenType = "user";
  report.observedAt = new Date().toISOString();
  const account = `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
  const worker = `${account}/workers/scripts/levi-dev`;

  async function read(check, path, project) {
    const entry = { check, outcome: "network_error" };
    report.checks.push(entry);
    try {
      const response = await fetcher(
        `https://api.cloudflare.com/client/v4${path}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            Accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
      entry.http = response.status;
      if (!response.ok) {
        entry.outcome =
          response.status === 401
            ? "unauthorized"
            : response.status === 403
              ? "forbidden"
              : response.status === 404
                ? "not_found"
                : response.status === 429 || response.status >= 500
                  ? "transient_http"
                  : "unexpected_http";
        await response.body?.cancel();
        return null;
      }
      entry.outcome = "unexpected_response";
      const body = await response.json();
      assert.ok(
        record(body) && body.success === true && Object.hasOwn(body, "result"),
      );
      const metadata = project(body.result);
      entry.metadata = metadata;
      entry.outcome = "ok";
      return metadata;
    } catch {
      // Inclui JSON inválido, timeout e exceções de rede sem serializar a causa.
      return null;
    }
  }

  const authentication = await read(
    "authentication",
    "/user/tokens/verify",
    (result) => {
      assert.ok(
        record(result) &&
          ["active", "disabled", "expired"].includes(result.status),
      );
      return { status: result.status };
    },
  );
  if (authentication && authentication.status !== "active")
    report.checks[0].outcome = "inactive";
  // As permissões de cada GET são evidências independentes; não trocar credencial
  // ou rota de verificação automaticamente após 401/403.
  await read(
    "hyperdrive",
    `${account}/hyperdrive/configs/${env.LEVI_HYPERDRIVE_ID}`,
    (result) => {
      assert.ok(
        record(result) &&
          result.id === env.LEVI_HYPERDRIVE_ID &&
          record(result.origin) &&
          typeof result.name === "string" &&
          ["host", "database", "user"].every(
            (key) => typeof result.origin[key] === "string",
          ),
      );
      return {
        expectedName: result.name === "levi-dev",
        expectedHost: result.origin.host === env.LEVI_DEV_DATABASE_HOST,
        expectedDatabase: result.origin.database === env.LEVI_DEV_DATABASE_NAME,
        runtimeRole: result.origin.user === "levi_dev_runtime",
        cacheDisabled:
          typeof result.caching?.disabled === "boolean"
            ? result.caching.disabled
            : null,
        tlsVerifyFull:
          typeof result.mtls?.sslmode === "string"
            ? result.mtls.sslmode === "verify-full"
            : null,
      };
    },
  );
  await read("worker", `${worker}/subdomain`, (result) => {
    assert.ok(
      record(result) &&
        typeof result.enabled === "boolean" &&
        typeof result.previews_enabled === "boolean",
    );
    return {
      workersDevEnabled: result.enabled,
      previewsEnabled: result.previews_enabled,
    };
  });
  await read(
    "domain",
    `${account}/workers/domains?hostname=levi.t00ls.dev&per_page=100`,
    (result) => {
      assert.ok(Array.isArray(result) && result.length <= 1);
      if (!result.length) return { present: false };
      const domain = result[0];
      assert.ok(
        record(domain) &&
          domain.hostname === "levi.t00ls.dev" &&
          typeof domain.service === "string" &&
          typeof domain.zone_id === "string" &&
          hex.test(domain.zone_id) &&
          typeof domain.enabled === "boolean" &&
          typeof domain.previews_enabled === "boolean",
      );
      return {
        present: true,
        expectedWorker: domain.service === "levi-dev",
        expectedZone: domain.zone_id === env.CLOUDFLARE_ZONE_ID,
        enabled: domain.enabled,
        previewsEnabled: domain.previews_enabled,
      };
    },
  );
  await read("zone", `/zones/${env.CLOUDFLARE_ZONE_ID}`, (result) => {
    assert.ok(
      record(result) &&
        typeof result.id === "string" &&
        hex.test(result.id) &&
        typeof result.name === "string" &&
        record(result.account) &&
        typeof result.account.id === "string" &&
        hex.test(result.account.id),
    );
    return {
      expectedZone:
        result.id === env.CLOUDFLARE_ZONE_ID && result.name === "t00ls.dev",
      expectedAccount: result.account?.id === env.CLOUDFLARE_ACCOUNT_ID,
    };
  });
  // Só registra a contagem relativa ao Worker alvo, sem emitir as demais rotas.
  await read(
    "routes",
    `/zones/${env.CLOUDFLARE_ZONE_ID}/workers/routes`,
    (result) => {
      assert.ok(
        Array.isArray(result) &&
          result.every(
            (route) =>
              record(route) &&
              typeof route.pattern === "string" &&
              (route.script == null || typeof route.script === "string"),
          ),
      );
      return {
        matchingRoutes: result.filter(
          (route) => record(route) && route.script === "levi-dev",
        ).length,
      };
    },
  );

  const deployment = (result) => {
    assert.ok(record(result) && Array.isArray(result.deployments));
    if (!result.deployments.length) return { id: null, traffic: [] };
    const latest = result.deployments[0];
    assert.ok(record(latest));
    const id = identifier(latest.id, uuid);
    assert.ok(
      id &&
        Array.isArray(latest.versions) &&
        latest.versions.length >= 1 &&
        latest.versions.length <= 2,
    );
    const traffic = latest.versions.map((version) => {
      assert.ok(record(version));
      const id = identifier(version.version_id, uuid);
      assert.ok(
        id &&
          typeof version.percentage === "number" &&
          Number.isFinite(version.percentage) &&
          version.percentage >= 0 &&
          version.percentage <= 100,
      );
      return { id, percentage: version.percentage };
    });
    assert.equal(
      new Set(traffic.map((version) => version.id)).size,
      traffic.length,
    );
    assert.equal(
      traffic.reduce((total, version) => total + version.percentage, 0),
      100,
    );
    return { id, traffic };
  };
  const versions = (result) => {
    assert.ok(
      record(result) && Array.isArray(result.items) && result.items.length <= 5,
    );
    const ids = result.items.map((version) => {
      assert.ok(record(version));
      const id = identifier(version.id, uuid);
      assert.ok(id);
      return id;
    });
    assert.equal(new Set(ids).size, ids.length);
    return { ids };
  };
  const active = await read("deployment", `${worker}/deployments`, deployment);
  const recent = await read(
    "recent_versions",
    `${worker}/versions?page=1&per_page=5`,
    versions,
  );
  const ids = [
    ...new Set([
      ...(active?.traffic.map((version) => version.id) ?? []),
      ...(recent?.ids.slice(0, 3) ?? []),
    ]),
  ];
  for (const id of ids) {
    await read("version", `${worker}/versions/${id}`, (result) => {
      assert.ok(
        record(result) &&
          result.id === id &&
          record(result.resources) &&
          Array.isArray(result.resources.bindings),
      );
      const bindings = result.resources.bindings;
      assert.ok(
        bindings.every(
          (item) =>
            record(item) &&
            typeof item.name === "string" &&
            typeof item.type === "string",
        ),
      );
      const binding = (name, type) => {
        const matches = bindings.filter(
          (item) => record(item) && item.name === name,
        );
        return matches.length === 1 && matches[0].type === type
          ? matches[0]
          : null;
      };
      return {
        id,
        sha: identifier(result.annotations?.["workers/tag"], sha),
        assets: !!binding("ASSETS", "assets"),
        expectedHyperdrive:
          binding("HYPERDRIVE", "hyperdrive")?.id === env.LEVI_HYPERDRIVE_ID,
        authSecretPresent: !!binding("LEVI_AUTH_SECRET", "secret_text"),
        resendSecretPresent: !!binding("RESEND_API_KEY", "secret_text"),
        expectedOrigin:
          binding("LEVI_PUBLIC_ORIGIN", "plain_text")?.text ===
          "https://levi.t00ls.dev",
      };
    });
  }
  const finalActive = await read(
    "deployment_recheck",
    `${worker}/deployments`,
    deployment,
  );
  const finalRecent = await read(
    "versions_recheck",
    `${worker}/versions?page=1&per_page=5`,
    versions,
  );
  report.stableSnapshot =
    active && finalActive && recent && finalRecent
      ? JSON.stringify(active) === JSON.stringify(finalActive) &&
        recent.ids[0] === finalRecent.ids[0]
      : null;
  report.activeIsLatest =
    active?.traffic.length === 1 && recent?.ids.length
      ? active.traffic[0].id === recent.ids[0]
      : null;
  report.ok =
    authentication?.status === "active" &&
    report.stableSnapshot === true &&
    report.checks.every((check) => check.outcome === "ok");
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const report = await diagnoseCloudflare(process.env);
    console.info(JSON.stringify(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch {
    console.error('{"ok":false,"outcome":"diagnostic_error"}');
    process.exitCode = 1;
  }
}
