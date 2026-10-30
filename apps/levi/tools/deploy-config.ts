import assert from "node:assert/strict";
import { resolve } from "node:path";

export const deployOrigin = "https://levi.t00ls.dev";
export const deployWorker = "levi-dev";
const emailFrom = "Levi <hi@levi.t00ls.dev>";
const previousEmailFrom = "Levi <noreply@levi.t00ls.dev>";

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  const entries: unknown[] = value;
  return entries.map((entry) => asRecord(entry));
}

// Capacidade exclusiva do executor: não pertence aos bindings do Worker.
export function maintenanceSmokeHeaders(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const mode = env.LEVI_MAINTENANCE_SMOKE ?? "false";
  if (mode === "false") return {};
  if (mode !== "true") throw new Error("Modo de smoke inválido.");
  const capability = env.LEVI_SMOKE_CAPABILITY ?? "";
  // 32 bytes aleatórios em hex, provisionados somente sob autorização operacional.
  if (!/^[a-f0-9]{64}$/.test(capability))
    throw new Error("Capacidade temporária de smoke ausente ou inválida.");
  return { "X-Levi-Smoke-Capability": capability };
}

export function deploySettings(env: NodeJS.ProcessEnv) {
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_REPOSITORY, "t00ls-dev/foundation");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REF, "refs/heads/master");
  assert.equal(env.LEVI_DEV_READY, "true");
  const sha = env.LEVI_DEPLOY_SHA ?? "";
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.equal(sha, env.GITHUB_SHA);
  const account = env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const hyperdrive = env.LEVI_HYPERDRIVE_ID ?? "";
  assert.match(account, /^[a-f0-9]{32}$/);
  assert.match(env.CLOUDFLARE_ZONE_ID ?? "", /^[a-f0-9]{32}$/);
  assert.match(hyperdrive, /^[a-f0-9]{32}$/);
  assert.notEqual(hyperdrive, "0".repeat(32));
  assert.match(
    env.LEVI_DEV_DATABASE_HOST ?? "",
    /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/,
  );
  assert.ok(!env.LEVI_DEV_DATABASE_HOST!.split(".")[0]!.includes("-pooler"));
  assert.match(env.LEVI_DEV_DATABASE_NAME ?? "", /^levi_dev(?:_[a-z0-9_]+)?$/);
  for (const name of ["GITHUB_TOKEN", "CLOUDFLARE_API_TOKEN", "RESEND_API_KEY"])
    assert.ok(env[name]?.trim());
  // Sem fallback para AUTH_SECRET ou para o valor remoto previamente publicado.
  assert.ok((env.LEVI_AUTH_SECRET?.trim().length ?? 0) >= 32);
  assert.equal(env.LEVI_EMAIL_FROM, emailFrom);
  return { sha, account, hyperdrive };
}

export function verifyHyperdrive(config: unknown, env: NodeJS.ProcessEnv) {
  const value = asRecord(config);
  const caching = asRecord(value.caching);
  const origin = asRecord(value.origin);
  const mtls = asRecord(value.mtls);
  assert.equal(value.id, env.LEVI_HYPERDRIVE_ID);
  assert.equal(value.name, deployWorker);
  assert.equal(caching.disabled, true);
  assert.equal(origin.host, env.LEVI_DEV_DATABASE_HOST);
  assert.equal(origin.database, env.LEVI_DEV_DATABASE_NAME);
  assert.equal(origin.user, "levi_dev_runtime");
  const scheme = origin.scheme;
  assert.ok(
    typeof scheme === "string" && ["postgres", "postgresql"].includes(scheme),
  );
  assert.equal(origin.port, 5432);
  assert.equal(mtls.sslmode, "verify-full");
  assert.match(
    typeof mtls.ca_certificate_id === "string" ? mtls.ca_certificate_id : "",
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  );
}

export function verifyWorkerBindings(version: unknown, env: NodeJS.ProcessEnv) {
  const value = asRecord(version);
  const resources = asRecord(value.resources);
  const bindings = asRecordArray(resources.bindings);
  const hyperdrives = bindings.filter((b) => b.type === "hyperdrive");
  assert.equal(hyperdrives.length, 1);
  const hyperdrive = hyperdrives[0];
  assert.ok(hyperdrive);
  assert.equal(hyperdrive.name, "HYPERDRIVE");
  assert.equal(hyperdrive.id, env.LEVI_HYPERDRIVE_ID);
  for (const [name, type, text] of [
    ["ASSETS", "assets"],
    ["LEVI_AUTH_SECRET", "secret_text"],
    ["RESEND_API_KEY", "secret_text"],
    ["LEVI_PUBLIC_ORIGIN", "plain_text", deployOrigin],
    ["LEVI_EMAIL_FROM", "plain_text", env.LEVI_EMAIL_FROM],
  ]) {
    const matches = bindings.filter((binding) => binding.name === name);
    assert.equal(matches.length, 1);
    const match = matches[0];
    assert.ok(match);
    assert.equal(match.type, type);
    if (type === "plain_text") assert.equal(match.text, text);
  }
}

// Compatibilidade somente com a versão original comprovada para o primeiro corte.
// Uma versão futura/reenviada com noreply não recebe essa exceção.
export function verifyPreviousWorkerBindings(
  version: unknown,
  env: NodeJS.ProcessEnv,
  identity: { versionId: string; sha: string },
): "legacy" | "current" {
  const value = asRecord(version);
  const resources = asRecord(value.resources);
  const bindings = asRecordArray(resources.bindings);
  const from = bindings.find(
    (binding) => binding.name === "LEVI_EMAIL_FROM",
  )?.text;
  const legacy = from === previousEmailFrom;
  if (legacy) {
    assert.equal(identity.versionId, "526d47d8-39cc-46af-8ec5-1bf2bf3d7282");
    assert.equal(identity.sha, "b2c892e27e3a8988f0be554692ffea43d35fcd61");
    assert.equal(env.LEVI_EMAIL_FROM, emailFrom);
  }
  verifyWorkerBindings(
    version,
    legacy ? { ...env, LEVI_EMAIL_FROM: previousEmailFrom } : env,
  );
  return legacy ? "legacy" : "current";
}

export function deploymentConfig(base: unknown, hyperdrive: string) {
  const value = asRecord(base);
  const hyperdriveConfigs = asRecordArray(value.hyperdrive);
  const observability = asRecord(value.observability);
  const logs = asRecord(observability.logs);
  const traces = asRecord(observability.traces);
  const assets = asRecord(value.assets);
  const vars = asRecord(value.vars);
  assert.equal(value.name, deployWorker);
  assert.equal(value.workers_dev, false);
  assert.equal(value.preview_urls, false);
  assert.deepEqual(value.routes, []);
  assert.equal(hyperdriveConfigs.length, 1);
  const hyperdriveConfig = hyperdriveConfigs[0];
  assert.ok(hyperdriveConfig);
  assert.equal(hyperdriveConfig.binding, "HYPERDRIVE");
  assert.equal(observability.enabled, false);
  assert.equal(logs.enabled, false);
  assert.equal(logs.invocation_logs, false);
  assert.equal(traces.enabled, false);
  const main = value.main;
  assert.ok(typeof main === "string");
  const directory = assets.directory;
  assert.ok(typeof directory === "string");
  const configVars: Record<string, unknown> = {
    ...vars,
    LEVI_PUBLIC_ORIGIN: deployOrigin,
  };
  return {
    ...value,
    $schema: undefined,
    workers_dev: false,
    preview_urls: false,
    observability,
    main: resolve(main),
    assets: { ...assets, directory: resolve(directory) },
    hyperdrive: [{ binding: "HYPERDRIVE", id: hyperdrive }],
    secrets: { required: ["LEVI_AUTH_SECRET", "RESEND_API_KEY"] },
    routes: [{ pattern: new URL(deployOrigin).hostname, custom_domain: true }],
    vars: configVars,
  };
}
