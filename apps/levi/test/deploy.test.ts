import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, statfs, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { administrativeEmail } from "../src/admin-config.js";
import {
  classifyDeployError,
  DeployDiagnostics,
} from "../tools/deploy-diagnostics.js";
import {
  deploySettings,
  maintenanceSmokeHeaders,
  verifyHyperdrive,
  verifyWorkerBindings,
  verifyPreviousWorkerBindings,
  deploymentConfig,
} from "../tools/deploy-config.js";

const valid = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "t00ls-dev/foundation",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/master",
  LEVI_DEV_READY: "true",
  LEVI_DEPLOY_SHA: "a".repeat(40),
  GITHUB_SHA: "a".repeat(40),
  GITHUB_TOKEN: "synthetic-only",
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_ZONE_ID: "d".repeat(32),
  CLOUDFLARE_API_TOKEN: "synthetic-only",
  LEVI_HYPERDRIVE_ID: "c".repeat(32),
  LEVI_DEV_DATABASE_HOST: "ep-synthetic-only.us-east-2.aws.neon.tech",
  LEVI_DEV_DATABASE_NAME: "levi_dev",
  LEVI_EMAIL_FROM: "Levi <hi@levi.t00ls.dev>",
  LEVI_AUTH_SECRET: "synthetic-only-secret-with-more-than-32-characters",
  RESEND_API_KEY: "resend-synthetic-not-real-key",
  LEVI_ADMIN_EMAIL: "synthetic-private-admin@example.test",
  AUTH_SECRET: "github-auth-synthetic-different-from-remote",
} satisfies NodeJS.ProcessEnv;
const versionId = "11111111-1111-4111-8111-111111111111";
const previousVersionId = "33333333-3333-4333-8333-333333333333";
const baseBindings = [
  { type: "hyperdrive", name: "HYPERDRIVE", id: valid.LEVI_HYPERDRIVE_ID },
  { type: "assets", name: "ASSETS" },
  { type: "secret_text", name: "LEVI_AUTH_SECRET" },
  { type: "secret_text", name: "RESEND_API_KEY" },
  { type: "secret_text", name: "LEVI_ADMIN_EMAIL" },
  {
    type: "plain_text",
    name: "LEVI_PUBLIC_ORIGIN",
    text: "https://levi.t00ls.dev",
  },
  { type: "plain_text", name: "LEVI_EMAIL_FROM", text: valid.LEVI_EMAIL_FROM },
];
const hyperdrive = {
  id: valid.LEVI_HYPERDRIVE_ID,
  name: "levi-dev",
  caching: { disabled: true },
  mtls: {
    sslmode: "verify-full",
    ca_certificate_id: "22222222-2222-4222-8222-222222222222",
  },
  origin: {
    port: 5432,
    host: valid.LEVI_DEV_DATABASE_HOST,
    database: "levi_dev",
    user: "levi_dev_runtime",
    scheme: "postgres",
  },
};

void test("deploy exige execução confiável manual da master e configuração completa, sem credenciais de migrations", () => {
  assert.equal(deploySettings(valid).sha, valid.GITHUB_SHA);
  for (const changes of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REPOSITORY: "unrelated/levi" },
    { GITHUB_EVENT_NAME: "workflow_run" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/main" },
    { GITHUB_REPOSITORY: "other/levi" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/feature" },
    { LEVI_DEV_READY: "false" },
    { GITHUB_SHA: "b".repeat(40) },
    { LEVI_DEPLOY_SHA: "not-a-sha" },
    { CLOUDFLARE_API_TOKEN: "" },
    { RESEND_API_KEY: "" },
    { RESEND_API_KEY: "   " },
    { CLOUDFLARE_ZONE_ID: "" },
    { LEVI_HYPERDRIVE_ID: "0".repeat(32) },
    { LEVI_DEV_DATABASE_NAME: "foundation" },
    {
      LEVI_DEV_DATABASE_HOST:
        "ep-synthetic-only-pooler.us-east-2.aws.neon.tech",
    },
    { LEVI_EMAIL_FROM: "" },
    { LEVI_EMAIL_FROM: "Levi <noreply@levi.t00ls.dev>" },
    { LEVI_EMAIL_FROM: "Levi <other@levi.t00ls.dev>" },
  ])
    assert.throws(() => deploySettings({ ...valid, ...changes }));
});

void test("Hyperdrive exige cache desabilitado, recurso e role exclusivos e alvo DEV esperado", () => {
  verifyHyperdrive(hyperdrive, valid);
  for (const changes of [
    { id: "d".repeat(32) },
    { name: "foundation" },
    { caching: { disabled: false } },
    { caching: {} },
    { mtls: { sslmode: "require" } },
    { mtls: { sslmode: "verify-full" } },
    { origin: { ...hyperdrive.origin, port: 6432 } },
    { origin: { ...hyperdrive.origin, host: "another.neon.tech" } },
    { origin: { ...hyperdrive.origin, database: "foundation" } },
    { origin: { ...hyperdrive.origin, user: "levi_dev_migrator" } },
  ])
    assert.throws(() => verifyHyperdrive({ ...hyperdrive, ...changes }, valid));
});

async function readWorkerConfig() {
  const parsed = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    await readFile("wrangler.jsonc", "utf8"),
  );
  assert.ok(!parsed.error);
  const config: unknown = parsed.config;
  assert.ok(config && typeof config === "object");
  assert.ok("vars" in config && config.vars && typeof config.vars === "object");
  assert.ok("routes" in config);
  assert.ok("observability" in config);
  const observability = config.observability;
  assert.ok(observability && typeof observability === "object");
  assert.ok("enabled" in observability);
  assert.ok(
    "logs" in observability &&
      observability.logs &&
      typeof observability.logs === "object",
  );
  assert.ok(
    "traces" in observability &&
      observability.traces &&
      typeof observability.traces === "object",
  );
  assert.ok("invocation_logs" in observability.logs);
  assert.ok("enabled" in observability.traces);
  return {
    ...config,
    observability: {
      ...observability,
      logs: observability.logs,
      traces: observability.traces,
    },
    vars: config.vars,
  };
}

void test("configuração temporária preserva logs fechados e não altera Wrangler local", async () => {
  const base = await readWorkerConfig();
  const original = JSON.stringify(base);
  const result = deploymentConfig(base, valid.LEVI_HYPERDRIVE_ID);
  assert.equal(JSON.stringify(base), original);
  assert.deepEqual(base.routes, []);
  assert.deepEqual(result.routes, [
    { pattern: "levi.t00ls.dev", custom_domain: true },
  ]);
  assert.equal(result.workers_dev, false);
  assert.equal(result.preview_urls, false);
  assert.equal(result.hyperdrive[0]?.id, valid.LEVI_HYPERDRIVE_ID);
  assert.deepEqual(result.secrets.required, [
    "LEVI_AUTH_SECRET",
    "RESEND_API_KEY",
  ]);
  assert.deepEqual(result.observability, base.observability);
  assert.equal(base.observability.enabled, false);
  assert.equal(base.observability.logs.invocation_logs, false);
  assert.equal(base.observability.traces.enabled, false);
  assert.ok(!JSON.stringify(result).includes(valid.LEVI_AUTH_SECRET));
  assert.throws(() =>
    deploymentConfig({ ...base, workers_dev: true }, valid.LEVI_HYPERDRIVE_ID),
  );
  assert.throws(() =>
    deploymentConfig({ ...base, preview_urls: true }, valid.LEVI_HYPERDRIVE_ID),
  );
  assert.throws(() =>
    deploymentConfig(
      {
        ...base,
        observability: {
          ...base.observability,
          logs: { enabled: false, invocation_logs: true },
        },
      },
      valid.LEVI_HYPERDRIVE_ID,
    ),
  );
});

void test("CLI sem contexto autorizado falha antes de qualquer rede e sanitiza valores privados", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "tools/deploy-dev.ts"],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH, LEVI_AUTH_SECRET: valid.LEVI_AUTH_SECRET },
    },
  );
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.ok(output.includes("etapa: configuração"));
  assert.ok(output.includes("verificação: contexto e configuração DEV"));
  assert.ok(output.includes("categoria: divergência de configuração"));
  assert.ok(!output.includes(valid.LEVI_AUTH_SECRET));
  assert.ok(!output.includes("AssertionError"));
});

// Executa o script real com todas as fronteiras de I/O substituídas: nenhum
// subprocesso, arquivo privado ou request real pode ser criado pelo harness.
async function simulatedDeploy(
  options: {
    env?: NodeJS.ProcessEnv;
    inspectRequest?: (url: string, init: RequestInit) => void;
    respond?: (url: string, published: boolean) => Response | undefined;
    cleanupError?: Error;
    memoryType?: number;
    secretWriteError?: Error;
    uploadError?: Error;
    failProgress?: boolean;
    failReport?: boolean;
    ciEvidence?: (call: number) => {
      sha: string;
      runId: number;
      attempt: number;
    };
  } = {},
) {
  const source = await readFile("tools/deploy-dev.ts", "utf8");
  const baseConfig = await readFile("wrangler.jsonc", "utf8");
  const output: string[] = [];
  const requests: string[] = [];
  const writes: { path: string; mode: number }[] = [];
  let writtenVars: unknown;
  let writtenSecrets: Record<string, unknown> = {};
  let uploads = 0;
  let ciCalls = 0;
  let cleanups = 0;
  const fakeProcess = {
    env: {
      ...valid,
      ...options.env,
    },
    execPath: process.execPath,
    exitCode: 0,
  };
  const headers = {
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'",
    "cache-control": "private, no-store",
  };
  const cloudflare = (result: unknown) =>
    Response.json({ success: true, result });
  const request = async (input: string, init: RequestInit) => {
    requests.push(input);
    options.inspectRequest?.(input, init);
    if (new URL(input).hostname === "api.cloudflare.com")
      assert.equal(
        new Headers(init.headers).get("Authorization"),
        `Bearer ${valid.CLOUDFLARE_API_TOKEN}`,
      );
    const override = options.respond?.(input, uploads > 0);
    if (override) return Promise.resolve(override);
    const url = new URL(input);
    if (url.hostname === "api.github.com")
      return Promise.resolve(
        Response.json({ object: { sha: valid.GITHUB_SHA } }),
      );
    if (url.pathname.includes("/hyperdrive/configs/"))
      return Promise.resolve(cloudflare(hyperdrive));
    if (url.pathname.endsWith("/subdomain"))
      return Promise.resolve(
        cloudflare({ enabled: false, previews_enabled: false }),
      );
    if (url.pathname.endsWith("/workers/domains"))
      return Promise.resolve(
        cloudflare([
          {
            hostname: "levi.t00ls.dev",
            service: "levi-dev",
            zone_id: valid.CLOUDFLARE_ZONE_ID,
            enabled: true,
            previews_enabled: false,
          },
        ]),
      );
    if (url.pathname.endsWith("/workers/routes"))
      return Promise.resolve(cloudflare([]));
    if (url.pathname.includes("/zones/"))
      return Promise.resolve(
        cloudflare({
          name: "t00ls.dev",
          account: { id: valid.CLOUDFLARE_ACCOUNT_ID },
        }),
      );
    if (url.pathname.endsWith("/deployments"))
      return Promise.resolve(
        cloudflare({
          deployments: [
            {
              versions: [
                {
                  version_id: uploads ? versionId : previousVersionId,
                  percentage: 100,
                },
              ],
            },
          ],
        }),
      );
    if (url.pathname.includes("/versions/"))
      return Promise.resolve(
        cloudflare({
          annotations: {
            "workers/tag": uploads ? valid.GITHUB_SHA : "e".repeat(40),
          },
          resources: {
            bindings: baseBindings,
          },
        }),
      );
    if (url.pathname.endsWith("/versions"))
      return Promise.resolve(
        cloudflare({
          items: [{ id: uploads ? versionId : previousVersionId }],
        }),
      );
    if (url.hostname === "levi.t00ls.dev") {
      if (url.pathname === "/")
        return Promise.resolve(
          new Response("<html></html>", {
            headers: { ...headers, "content-type": "text/html" },
          }),
        );
      if (url.pathname === "/api/onboarding")
        return Promise.resolve(Response.json({ etapa: "email" }, { headers }));
      if (url.pathname === "/api/members")
        return Promise.resolve(
          new Response(null, {
            status: 401,
            headers,
          }),
        );
      if (["/admin", "/api/admin/session"].includes(url.pathname))
        return Promise.resolve(new Response(null, { status: 404, headers }));
      if (["/api/churches", "/api/churches"].includes(url.pathname))
        return Promise.resolve(new Response(null, { status: 401, headers }));
    }
    throw new Error("Request não previsto no harness");
  };
  const modules: Record<string, unknown> = {
    // Literais do VM e JSON do Response pertencem a realms distintos. Igualar
    // apenas seus protótipos no harness mantém o deepEqual estrutural do script.
    "node:assert/strict": new Proxy(assert, {
      get(target, key, receiver) {
        if (key === "deepEqual")
          return (actual: unknown, expected: unknown) =>
            assert.deepEqual(
              JSON.parse(JSON.stringify(actual)),
              JSON.parse(JSON.stringify(expected)),
            );
        const value: unknown = Reflect.get(target, key, receiver);
        return value;
      },
    }),
    "node:path": { join, resolve },
    "node:child_process": {
      execFileSync: (_cmd: string, args: string[]) =>
        args[0] === "rev-parse" ? valid.GITHUB_SHA : "",
      spawnSync: (
        _command: string,
        args: string[],
        settings: { env: NodeJS.ProcessEnv },
      ) => {
        assert.equal(
          settings.env.CLOUDFLARE_API_TOKEN,
          valid.CLOUDFLARE_API_TOKEN,
        );
        assert.equal("CLOUDFLARE_READ_TOKEN" in settings.env, false);
        const secretsIndex = args.indexOf("--secrets-file");
        assert.ok(secretsIndex > 0);
        assert.equal(
          args[secretsIndex + 1],
          "/dev/shm/levi-dev-deploy-synthetic-only/secrets.json",
        );
        assert.deepEqual(Object.keys(writtenSecrets), [
          "RESEND_API_KEY",
          "LEVI_AUTH_SECRET",
          "LEVI_ADMIN_EMAIL",
        ]);
        assert.equal(
          writtenSecrets.RESEND_API_KEY,
          fakeProcess.env.RESEND_API_KEY,
        );
        assert.equal(
          writtenSecrets.LEVI_AUTH_SECRET,
          fakeProcess.env.LEVI_AUTH_SECRET,
        );
        for (const name of [
          "LEVI_ADMIN_EMAIL",
          "LEVI_SMOKE_CAPABILITY",
          "AUTH_SECRET",
          "LEVI_AUTH_SECRET",
          "RESEND_API_KEY",
        ])
          assert.equal(settings.env[name], undefined);
        assert.ok(!args.join(" ").includes(valid.RESEND_API_KEY));
        assert.ok(!args.join(" ").includes(valid.LEVI_AUTH_SECRET));
        assert.equal(
          writtenSecrets.LEVI_ADMIN_EMAIL,
          administrativeEmail(fakeProcess.env.LEVI_ADMIN_EMAIL) ?? "",
        );
        assert.ok(!args.join(" ").includes(valid.LEVI_ADMIN_EMAIL));
        uploads++;
        return options.uploadError
          ? { status: 1, error: options.uploadError, stderr: sensitive }
          : { status: 0 };
      },
    },
    "node:fs/promises": {
      readFile: async () => Promise.resolve(baseConfig),
      statfs: async (path: string) => {
        assert.equal(path, "/dev/shm");
        return Promise.resolve({ type: options.memoryType ?? 0x01021994 });
      },
      mkdtemp: async (prefix: string) =>
        Promise.resolve(prefix + "synthetic-only"),
      writeFile: async (
        path: string,
        contents: string,
        settings: { mode: number; flag?: string },
      ) => {
        assert.ok(!contents.includes(valid.AUTH_SECRET));
        assert.equal(settings.mode, 0o600);
        assert.ok(!contents.includes("f".repeat(64)));
        assert.ok(path.startsWith("/dev/shm/levi-dev-deploy-"));
        if (path.endsWith("secrets.json")) {
          assert.equal(settings.flag, "wx");
          if (options.secretWriteError) throw options.secretWriteError;
          const secrets: unknown = JSON.parse(contents);
          assert.ok(secrets && typeof secrets === "object");
          writtenSecrets = Object.fromEntries(Object.entries(secrets));
        } else {
          assert.ok(!contents.includes(valid.RESEND_API_KEY));
          assert.ok(!contents.includes(valid.LEVI_AUTH_SECRET));
          assert.ok(!contents.includes(valid.LEVI_ADMIN_EMAIL));
          const config: unknown = JSON.parse(contents);
          assert.ok(config && typeof config === "object" && "vars" in config);
          writtenVars = config.vars;
        }
        writes.push({ path, mode: settings.mode });
        return Promise.resolve();
      },
      rm: async () => {
        cleanups++;
        if (options.cleanupError) throw options.cleanupError;
        return Promise.resolve();
      },
    },
    typescript: ts,
    "../src/admin-config.js": { administrativeEmail },
    "./deploy-config.js": {
      deploySettings,
      maintenanceSmokeHeaders,
      verifyHyperdrive,
      verifyWorkerBindings,
      verifyPreviousWorkerBindings,
      deploymentConfig,
      deployOrigin: "https://levi.t00ls.dev",
      deployWorker: "levi-dev",
    },
    "./deploy-diagnostics.js": { DeployDiagnostics },
    "./ci-evidence.js": {
      requireSuccessfulCI: async () => {
        ciCalls++;
        return Promise.resolve(
          options.ciEvidence?.(ciCalls) ?? {
            sha: valid.GITHUB_SHA,
            runId: 1,
            attempt: 1,
          },
        );
      },
    },
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  });
  await runInNewContext(`(async () => { ${compiled.outputText} })()`, {
    require: (name: string) => {
      assert.ok(name in modules);
      return modules[name];
    },
    exports: {},
    process: fakeProcess,
    fetch: request,
    URL,
    AbortSignal,
    setTimeout: (callback: () => void) => callback(),
    console: {
      info: (message: string) => {
        if (options.failProgress && message.startsWith("Deploy DEV:"))
          throw new Error(sensitive);
        output.push(message);
      },
      error: (message: string) => {
        if (options.failReport) throw new Error(sensitive);
        output.push(message);
      },
    },
  });
  return {
    output: output.join("\n"),
    requests,
    uploads,
    cleanups,
    writes,
    writtenVars,
    secretNames: Object.keys(writtenSecrets),
    ciCalls,
    exitCode: fakeProcess.exitCode,
  };
}

void test("readiness inválido bloqueia antes de CI, consultas, arquivos e upload", async () => {
  for (const value of [
    undefined,
    "",
    "false",
    "TRUE",
    "1",
    " true ",
    "invalid",
  ]) {
    const result = await simulatedDeploy({ env: { LEVI_DEV_READY: value } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.equal(result.requests.length, 0);
    assert.equal(result.ciCalls, 0);
    assert.equal(result.writes.length, 0);
  }
});

void test("token único ausente não usa token legado nem inicia operação privilegiada", async () => {
  const result = await simulatedDeploy({
    env: {
      CLOUDFLARE_API_TOKEN: undefined,
      CLOUDFLARE_READ_TOKEN: "legacy-must-not-be-used",
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.ciCalls, 0);
  assert.equal(result.requests.length, 0);
  assert.equal(result.writes.length, 0);
  assert.equal(result.uploads, 0);
});

const sensitive =
  "postgres://user:private-password@private.invalid/db?token=private-token\nAuthorization: Bearer private-token\nCookie: session=private-cookie";

void test("diagnóstico: sucesso conserva publicação única, checks, arquivos privados e limpeza", async () => {
  const result = await simulatedDeploy();
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(result.uploads, 1);
  assert.equal(result.cleanups, 1);
  assert.equal(result.writes.length, 2);
  assert.ok(result.writes.every((file) => file.mode === 0o600));
  assert.ok(
    result.output.includes(
      "SHA ativo, acesso público e bloqueio de dados privados conferidos",
    ),
  );
  for (const path of [
    "/",
    "/admin",
    "/api/admin/session",
    "/api/onboarding",
    "/api/churches",
    "/api/churches",
    "/api/members",
  ])
    assert.ok(result.requests.includes(`https://levi.t00ls.dev${path}`));
  assert.ok(!result.output.includes(valid.LEVI_AUTH_SECRET));
});

void test("diagnóstico: HTTP pós-upload identifica operação/status e interrompe sem retry", async () => {
  const result = await simulatedDeploy({
    respond: (url, published) =>
      published && url.endsWith("/deployments")
        ? new Response(sensitive, { status: 403 })
        : undefined,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 1);
  assert.equal(result.cleanups, 1);
  assert.ok(
    result.output.includes(
      "etapa: verificação após publicação; verificação: consulta dos deployments do Worker; categoria: falha HTTP; status HTTP: 403",
    ),
  );
  assert.equal(
    result.requests.filter((url) => url.endsWith("/deployments")).length,
    3,
  );
  assert.ok(
    !result.requests.some((url) => url.startsWith("https://levi.t00ls.dev")),
  );
  assert.ok(!result.output.includes("private-"));
});

void test("diagnóstico: HTTP anterior ao upload interrompe sem chamar o publicador", async () => {
  const result = await simulatedDeploy({
    respond: (url) =>
      url.includes("/hyperdrive/configs/")
        ? new Response(sensitive, { status: 503 })
        : undefined,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 0);
  assert.ok(
    result.output.includes(
      "etapa: proteções remotas; verificação: consulta do Hyperdrive; categoria: falha HTTP; status HTTP: 503",
    ),
  );
  assert.ok(!result.output.includes("private-"));
});

void test("diagnóstico: JSON inválido e envelope reprovado são respostas inesperadas sem corpo privado", async () => {
  for (const response of [
    new Response(sensitive),
    Response.json({ success: false, errors: [{ message: sensitive }] }),
  ]) {
    const result = await simulatedDeploy({
      respond: (url) => (url.endsWith("/deployments") ? response : undefined),
    });
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.output.includes(
        "consulta dos deployments do Worker; categoria: resposta inesperada; status HTTP: 200",
      ),
    );
    assert.ok(!result.output.includes("private-"));
  }
});

void test("diagnóstico: formato inválido e tráfego divergente mantêm HTTP sem aceitar deployment incompleto", async () => {
  for (const [resultBody, category, check] of [
    [
      { deployments: [] },
      "resposta inesperada",
      "estrutura das versões do deployment",
    ],
    [
      {
        deployments: [
          { versions: [{ version_id: versionId, percentage: 50 }] },
        ],
      },
      "divergência de configuração",
      "versão única com 100% do tráfego",
    ],
    [
      {
        deployments: [
          {
            versions: [
              { version_id: versionId, percentage: 50 },
              { version_id: previousVersionId, percentage: 50 },
            ],
          },
        ],
      },
      "divergência de configuração",
      "versão única com 100% do tráfego",
    ],
  ] as const) {
    const result = await simulatedDeploy({
      respond: (url) =>
        url.endsWith("/deployments")
          ? Response.json({ success: true, result: resultBody })
          : undefined,
    });
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.output.includes(
        `verificação: ${check}; categoria: ${category}; status HTTP: 200`,
      ),
    );
    assert.ok(!result.requests.some((url) => url.includes("/versions/")));
  }
});

void test("diagnóstico: divergências de proteção e tag localizam check sem imprimir valores recebidos", async () => {
  for (const [operation, expected] of [
    ["hyperdrive", "origem e cache do Hyperdrive"],
    ["tag", "tag da versão ativa igual ao SHA"],
  ]) {
    const result = await simulatedDeploy({
      respond: (url, published) => {
        if (
          operation === "hyperdrive" &&
          published &&
          url.includes("/hyperdrive/configs/")
        )
          return Response.json({
            success: true,
            result: { ...hyperdrive, caching: { disabled: false } },
          });
        if (operation === "tag" && published && url.includes("/versions/"))
          return Response.json({
            success: true,
            result: { annotations: { "workers/tag": sensitive } },
          });
        return undefined;
      },
    });
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.output.includes(
        `etapa: verificação após publicação; verificação: ${expected}; categoria: divergência de configuração`,
      ),
    );
    assert.ok(!result.output.includes("private-"));
  }
});

void test("diagnóstico: falha de rede preserva apenas código técnico conhecido", async () => {
  const result = await simulatedDeploy({
    respond: (url) => {
      if (url.endsWith("/deployments"))
        throw new Error(sensitive, {
          cause: { code: "ENOTFOUND", message: sensitive },
        });
      return undefined;
    },
  });
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.output.includes(
      "categoria: erro de rede; status HTTP: indisponível; causa técnica: ENOTFOUND",
    ),
  );
  assert.ok(!result.output.includes("private-"));
  const diagnostics = new DeployDiagnostics();
  diagnostics.start("version-tag");
  assert.ok(
    !diagnostics
      .message({ code: sensitive, message: sensitive, stack: sensitive })
      .includes("private-"),
  );
});

void test("diagnóstico: resposta pública divergente mantém 401 obrigatório e interrompe o smoke", async () => {
  const result = await simulatedDeploy({
    respond: (url) =>
      url === "https://levi.t00ls.dev/api/churches"
        ? new Response(sensitive, {
            status: 200,
            headers: {
              "referrer-policy": "no-referrer",
              "content-security-policy": "default-src 'self'",
            },
          })
        : undefined,
  });
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.output.includes(
      "bloqueio anônimo e cabeçalhos de igrejas; categoria: falha HTTP; status HTTP: 200",
    ),
  );
  assert.ok(!result.requests.includes("https://levi.t00ls.dev/api/members"));
  assert.ok(!result.output.includes("private-"));
});

void test("diagnóstico: falha na limpeza preserva exit 1 e não expõe caminhos privados", async () => {
  const result = await simulatedDeploy({
    cleanupError: Object.assign(new Error(sensitive), { code: "EACCES" }),
  });
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.output.includes(
      "etapa: limpeza privada; verificação: remoção dos arquivos privados temporários; categoria: falha de operação local",
    ),
  );
  assert.ok(result.output.includes("causa técnica: EACCES"));
  assert.ok(!result.output.includes("private-"));
});

void test("diagnóstico alinhado ao Foundation: erros hostis não acionam getters, proxies ou coerção", () => {
  let touched = 0;
  const hostile: unknown = Object.create(
    null,
    Object.fromEntries(
      ["code", "cause", "name", "message", "stack", "toJSON"].map((key) => [
        key,
        {
          get() {
            touched++;
            throw new Error(sensitive);
          },
        },
      ]),
    ),
  );
  const proxy = new Proxy(
    {},
    {
      get() {
        touched++;
        throw new Error(sensitive);
      },
      getOwnPropertyDescriptor() {
        touched++;
        throw new Error(sensitive);
      },
      getPrototypeOf() {
        touched++;
        throw new Error(sensitive);
      },
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  for (const error of [
    hostile,
    proxy,
    revoked.proxy,
    cycle,
    { cause: proxy },
    Object.create({ code: "ENOENT" }),
    sensitive,
    null,
    7,
    { code: sensitive },
  ]) {
    assert.equal(classifyDeployError(error), "UNKNOWN");
    const diagnostics = new DeployDiagnostics();
    diagnostics.start("version-tag");
    assert.ok(!diagnostics.message(error).includes("private-"));
    assert.doesNotThrow(() =>
      diagnostics.report(error, () => {
        throw new Error(sensitive);
      }),
    );
  }
  assert.equal(touched, 0);
});

void test("diagnóstico alinhado ao Foundation: causas são próprias, fechadas, limitadas e cíclicas-seguras", () => {
  assert.equal(
    classifyDeployError(
      new Error(sensitive, { cause: { cause: { code: "ECONNRESET" } } }),
    ),
    "ECONNRESET",
  );
  assert.equal(
    classifyDeployError({ name: "TimeoutError", message: sensitive }),
    "TIMEOUT",
  );
  let deep: unknown = { code: "ENOENT" };
  for (let i = 0; i < 9; i++) deep = { cause: deep };
  assert.equal(classifyDeployError(deep), "UNKNOWN");
});

void test("diagnóstico alinhado ao Foundation: catálogos e status são validados também em runtime", () => {
  const output: string[] = [];
  const diagnostics = new DeployDiagnostics((message) => output.push(message));
  diagnostics.phase = sensitive as never;
  for (const status of [sensitive, -1, 99, 600, 200.5, NaN, Infinity]) {
    diagnostics.start(sensitive as never, sensitive as never, status as never);
    const message = diagnostics.message({ status: 403, statusCode: 401 });
    assert.ok(
      message.includes(
        "etapa: configuração; verificação: contexto e configuração DEV; categoria: divergência de configuração; status HTTP: indisponível",
      ),
    );
    assert.ok(!message.includes("private-"));
  }
  assert.ok(output.every((line) => !line.includes("private-")));
});

void test("diagnóstico alinhado ao Foundation: HTTP vem somente da resposta atual, incluindo 401 esperado do Levi", async () => {
  const diagnostics = new DeployDiagnostics();
  await diagnostics.request("deployments-read", async () =>
    Promise.resolve(new Response(sensitive, { status: 503 })),
  );
  assert.ok(
    diagnostics
      .message({ status: 401, statusCode: 403 })
      .includes("categoria: falha HTTP; status HTTP: 503"),
  );
  diagnostics.inspect("deployment-shape", "resposta inesperada");
  assert.ok(diagnostics.message(null).includes("status HTTP: 503"));
  const original: unknown = { cause: { code: "ENOTFOUND" }, status: 502 };
  await assert.rejects(
    diagnostics.request(
      "version-read",
      () =>
        new Promise<Response>(() => {
          throw original;
        }),
    ),
    (error) => error === original,
  );
  assert.ok(
    diagnostics
      .message(original)
      .includes(
        "categoria: erro de rede; status HTTP: indisponível; causa técnica: ENOTFOUND",
      ),
  );
  await diagnostics.request(
    "churches-read",
    async () => Promise.resolve(new Response(null, { status: 401 })),
    401,
  );
  assert.ok(
    diagnostics
      .message(null)
      .includes("categoria: resposta inesperada; status HTTP: 401"),
  );
  diagnostics.start("local-head", "falha de operação local");
  assert.ok(
    diagnostics
      .message({ code: "ENOENT", status: 200 })
      .includes("status HTTP: indisponível; causa técnica: ENOENT"),
  );
});

void test("diagnóstico alinhado ao Foundation: falha e duplicação do diagnóstico não alteram operações", async () => {
  const diagnostics = new DeployDiagnostics(() => {
    throw new Error(sensitive);
  });
  assert.equal(
    diagnostics.verify("version-tag", () => 42),
    42,
  );
  const original = Object.assign(new Error(sensitive), { code: "ECONNRESET" });
  const output: string[] = [];
  diagnostics.report(original, (line) => output.push(line));
  diagnostics.report(original, (line) => output.push(line));
  assert.equal(output.length, 1);
  assert.ok(!output[0]!.includes("private-"));
  const other = new Error(sensitive);
  diagnostics.message = () => {
    throw new Error(sensitive);
  };
  assert.doesNotThrow(() =>
    diagnostics.report(other, () =>
      assert.fail("Sem saída do classificador reprovado"),
    ),
  );
  await assert.rejects(
    diagnostics.request("version-read", async () => {
      return Promise.reject(other);
    }),
    (error) => error === other,
  );
});

void test("diagnóstico: logger de progresso reprovado não impede sucesso e logger de erro não impede exit 1", async () => {
  const success = await simulatedDeploy({ failProgress: true });
  assert.equal(success.exitCode, 0);
  assert.equal(success.uploads, 1);
  assert.ok(success.output.includes("SHA ativo"));
  for (const cleanup of [false, true]) {
    const failure = await simulatedDeploy({
      failReport: true,
      ...(cleanup
        ? { cleanupError: new Error(sensitive) }
        : {
            respond: (url: string, published: boolean) =>
              published && url.endsWith("/deployments")
                ? new Response(sensitive, { status: 403 })
                : undefined,
          }),
    });
    assert.equal(failure.exitCode, 1);
    assert.equal(failure.uploads, 1);
    assert.equal(failure.cleanups, 1);
    assert.ok(!failure.output.includes("private-"));
  }
});

void test("diagnóstico: status público reprovado é HTTP mesmo se cabeçalhos faltarem", async () => {
  const failure = await simulatedDeploy({
    respond: (url) =>
      url === "https://levi.t00ls.dev/"
        ? new Response(sensitive, { status: 503 })
        : undefined,
  });
  assert.equal(failure.exitCode, 1);
  assert.ok(
    failure.output.includes(
      "status e cabeçalhos da página inicial; categoria: falha HTTP; status HTTP: 503",
    ),
  );
  assert.ok(!failure.output.includes("private-"));
});

void test("deploy não configura recorte de membros e aceita binding legado sem compará-lo", async () => {
  const base = await readWorkerConfig();
  const config = deploymentConfig(base, valid.LEVI_HYPERDRIVE_ID);
  assert.equal("LEVI_MEMBERS_DEV_ORGANIZATIONS" in config.vars, false);
  const workflow = await readFile(
    "../../.github/workflows/deploy-levi-dev.yml",
    "utf8",
  );
  assert.ok(!workflow.includes("MEMBERS_DEV_ORGANIZATIONS"));
  for (const text of ["", "invalid", "8a61d0dd-ea54-4f23-9550-d8ca4b353b71"]) {
    const result = await simulatedDeploy({
      respond: (url) =>
        url.includes("/versions/")
          ? Response.json({
              success: true,
              result: {
                annotations: {
                  "workers/tag": url.includes(versionId)
                    ? valid.GITHUB_SHA
                    : "e".repeat(40),
                },
                resources: {
                  bindings: [
                    ...baseBindings,
                    {
                      type: "plain_text",
                      name: "LEVI_MEMBERS_DEV_ORGANIZATIONS",
                      text,
                    },
                  ],
                },
              },
            })
          : undefined,
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(result.uploads, 1);
    assert.deepEqual(result.writtenVars, {
      ...base.vars,
      LEVI_EMAIL_FROM: valid.LEVI_EMAIL_FROM,
    });
  }
});

void test("versão ativa exige binding único e ID esperado", async () => {
  const binding = {
    type: "hyperdrive",
    name: "HYPERDRIVE",
    id: valid.LEVI_HYPERDRIVE_ID,
  };
  verifyWorkerBindings({ resources: { bindings: baseBindings } }, valid);
  for (const bindings of [
    [],
    [binding, binding],
    [{ ...binding, id: "d".repeat(32) }],
    [{ ...binding, name: "OTHER" }],
  ]) {
    assert.throws(() =>
      verifyWorkerBindings({ resources: { bindings } }, valid),
    );
    const result = await simulatedDeploy({
      respond: (url) =>
        url.includes("/versions/")
          ? Response.json({
              success: true,
              result: {
                annotations: { "workers/tag": valid.GITHUB_SHA },
                resources: { bindings },
              },
            })
          : undefined,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.equal(result.writes.length, 0);
    assert.ok(
      result.output.includes("bindings, remetente e recorte da versão ativa"),
    );
    assert.ok(
      !result.requests.some((url) => url.startsWith("https://levi.t00ls.dev")),
    );
  }
});

void test("smoke exige membros bloqueados e não registra corpo de resposta divergente", async () => {
  const result = await simulatedDeploy({
    respond: (url) =>
      url === "https://levi.t00ls.dev/api/members"
        ? new Response(sensitive)
        : undefined,
  });
  assert.equal(result.exitCode, 1);
  assert.ok(result.output.includes("recorte de membros e cabeçalhos"));
  assert.ok(!result.output.includes("private-"));
});

void test("deploy não envia um SHA que ficou obsoleto durante a preparação", async () => {
  let reads = 0;
  const result = await simulatedDeploy({
    respond: (url) => {
      if (!url.startsWith("https://api.github.com/")) return undefined;
      reads++;
      return Response.json({
        object: { sha: reads === 1 ? valid.GITHUB_SHA : "f".repeat(40) },
      });
    },
  });
  assert.equal(reads, 2);
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 0);
  assert.equal(result.cleanups, 1);
});

void test("deploy recusa CI substituída imediatamente antes do upload e limpa arquivos privados", async () => {
  for (const scenario of ["attempt", "run"] as const) {
    const result = await simulatedDeploy({
      ciEvidence: (call) => ({
        sha: valid.GITHUB_SHA,
        runId: scenario === "run" && call === 2 ? 2 : 1,
        attempt: scenario === "attempt" && call === 2 ? 2 : 1,
      }),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.equal(result.cleanups, 1);
    assert.ok(
      result.output.includes("evidência CI inalterada antes do upload"),
    );
  }
});

void test("transferência recusa Worker/domínio ausente e 403 antes de arquivos ou upload", async () => {
  for (const [path, response] of [
    ["/subdomain", new Response(null, { status: 404 })],
    ["/workers/domains", Response.json({ success: true, result: [] })],
    ["/deployments", new Response(null, { status: 403 })],
    ["/versions", new Response(null, { status: 403 })],
  ] as const) {
    const result = await simulatedDeploy({
      respond: (url) =>
        new URL(url).pathname.endsWith(path) ? response : undefined,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.writes.length, 0);
    assert.equal(result.uploads, 0);
    assert.equal(result.cleanups, 0);
  }
});

void test("sincroniza autenticação e Resend exclusivamente do contrato canônico, sem legado", async () => {
  const result = await simulatedDeploy({ env: { AUTH_SECRET: undefined } });
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(result.uploads, 1);
  assert.equal(result.writes.length, 2);
  assert.ok(result.writes[0]!.path.endsWith("wrangler.json"));
  assert.ok(result.output.includes(previousVersionId));
  assert.deepEqual(result.secretNames, [
    "RESEND_API_KEY",
    "LEVI_AUTH_SECRET",
    "LEVI_ADMIN_EMAIL",
  ]);
  assert.ok(!result.output.includes(valid.LEVI_AUTH_SECRET));
});

void test("transferência bloqueia divergência de remetente e ausência de Assets/secrets", async () => {
  for (const bindings of [
    baseBindings.filter((b) => b.name !== "ASSETS"),
    baseBindings.filter((b) => b.name !== "LEVI_AUTH_SECRET"),
    baseBindings.filter((b) => b.name !== "RESEND_API_KEY"),
    baseBindings.map((b) =>
      b.name === "LEVI_EMAIL_FROM" ? { ...b, text: sensitive } : b,
    ),
    [...baseBindings, { type: "secret_text", name: "LEVI_AUTH_SECRET" }],
  ]) {
    const result = await simulatedDeploy({
      respond: (url) =>
        url.includes("/versions/")
          ? Response.json({
              success: true,
              result: {
                annotations: { "workers/tag": "e".repeat(40) },
                resources: { bindings },
              },
            })
          : undefined,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.equal(result.writes.length, 0);
    assert.ok(!result.output.includes("private-"));
  }
});

void test("transferência não herda secrets de versão enviada sem tráfego", async () => {
  const result = await simulatedDeploy({
    respond: (url) =>
      url.endsWith("/versions")
        ? Response.json({
            success: true,
            result: { items: [{ id: versionId }] },
          })
        : undefined,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 0);
  assert.equal(result.writes.length, 0);
  assert.ok(
    result.output.includes("versão de origem dos secrets igual à ativa"),
  );
});

void test("verificação pós-publicação aguarda convergência sem republicar", async () => {
  for (const stale of ["deployment", "versions"] as const) {
    let reads = 0;
    const result = await simulatedDeploy({
      respond: (url, published) => {
        if (!published) return undefined;
        if (url.endsWith("/deployments")) {
          reads++;
          if (stale === "deployment" && reads === 1)
            return Response.json({
              success: true,
              result: {
                deployments: [
                  {
                    versions: [
                      { version_id: previousVersionId, percentage: 100 },
                    ],
                  },
                ],
              },
            });
        }
        if (stale === "versions" && url.endsWith("/versions") && reads === 1)
          return Response.json({
            success: true,
            result: { items: [{ id: previousVersionId }] },
          });
        if (
          stale === "deployment" &&
          url.endsWith(`/versions/${previousVersionId}`)
        )
          return Response.json({
            success: true,
            result: {
              annotations: { "workers/tag": "e".repeat(40) },
              resources: { bindings: baseBindings },
            },
          });
        return undefined;
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.uploads, 1);
    assert.equal(reads, stale === "deployment" ? 3 : 2);
  }
});

void test("divergência persistente e SHA incorreto falham sem republicação", async () => {
  for (const mismatch of ["list", "sha"] as const) {
    let reads = 0;
    const result = await simulatedDeploy({
      respond: (url, published) => {
        if (!published) return undefined;
        if (url.endsWith("/deployments")) reads++;
        if (mismatch === "list" && url.endsWith("/versions"))
          return Response.json({
            success: true,
            result: { items: [{ id: previousVersionId }] },
          });
        if (mismatch === "sha" && url.includes("/versions/"))
          return Response.json({
            success: true,
            result: {
              annotations: { "workers/tag": "e".repeat(40) },
              resources: { bindings: baseBindings },
            },
          });
        return undefined;
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 1);
    assert.equal(reads, 7);
    assert.ok(!result.output.includes("private-"));
  }
});

void test("transferência interrompe se versão ativa mudar entre preflight e upload", async () => {
  let reads = 0;
  const result = await simulatedDeploy({
    respond: (url) => {
      if (url.endsWith("/deployments")) reads++;
      if (reads < 2) return undefined;
      if (url.endsWith("/deployments"))
        return Response.json({
          success: true,
          result: {
            deployments: [
              { versions: [{ version_id: versionId, percentage: 100 }] },
            ],
          },
        });
      if (url.endsWith("/versions"))
        return Response.json({
          success: true,
          result: { items: [{ id: versionId }] },
        });
      return undefined;
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 0);
  assert.equal(result.cleanups, 1);
  assert.ok(result.output.includes("versão ativa inalterada antes do upload"));
});

void test("smokes administrativos exigem 404 e no-store sem expor respostas", async () => {
  for (const path of ["/admin", "/api/admin/session"]) {
    for (const status of [200, 404]) {
      const result = await simulatedDeploy({
        respond: (url) =>
          url === `https://levi.t00ls.dev${path}`
            ? new Response(sensitive, {
                status,
                headers: {
                  "referrer-policy": "no-referrer",
                  "content-security-policy": "default-src 'self'",
                },
              })
            : undefined,
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.uploads, 1);
      assert.ok(!result.output.includes("private-"));
    }
  }
});

void test("domínio exige roteamento público ativo e previews fechados antes e depois do upload", async () => {
  for (const published of [false, true]) {
    for (const state of [
      { enabled: false, previews_enabled: true },
      { enabled: true, previews_enabled: true },
      { enabled: true },
      { previews_enabled: false },
      { enabled: "true", previews_enabled: false },
      { enabled: true, previews_enabled: "false" },
    ]) {
      const result = await simulatedDeploy({
        respond: (url, uploaded) =>
          uploaded === published &&
          new URL(url).pathname.endsWith("/workers/domains")
            ? Response.json({
                success: true,
                result: [
                  {
                    hostname: "levi.t00ls.dev",
                    service: "levi-dev",
                    zone_id: valid.CLOUDFLARE_ZONE_ID,
                    ...state,
                  },
                ],
              })
            : undefined,
      });
      assert.equal(result.exitCode, 1, JSON.stringify({ published, state }));
      assert.equal(result.uploads, published ? 1 : 0);
      assert.equal(result.writes.length, published ? 2 : 0);
      assert.equal(result.cleanups, published ? 1 : 0);
      assert.ok(result.output.includes("custom domains exclusivos do Levi"));
      assert.ok(
        !result.requests.some((url) =>
          url.startsWith("https://levi.t00ls.dev"),
        ),
      );
    }
  }
});

const originalTransferVersion = {
  id: "526d47d8-39cc-46af-8ec5-1bf2bf3d7282",
  sha: "b2c892e27e3a8988f0be554692ffea43d35fcd61",
  from: "Levi <noreply@levi.t00ls.dev>",
};
const foundationTransferVersion = {
  id: versionId,
  sha: valid.GITHUB_SHA,
  from: valid.LEVI_EMAIL_FROM,
};
// Somente respostas sintéticas: todas as chamadas/arquivos/subprocessos do runner são interceptados.
function transferResponse(
  url: string,
  snapshot: typeof originalTransferVersion,
): Response | undefined {
  let result: unknown;
  if (url.endsWith("/deployments"))
    result = {
      deployments: [
        { versions: [{ version_id: snapshot.id, percentage: 100 }] },
      ],
    };
  else if (url.endsWith("/versions")) result = { items: [{ id: snapshot.id }] };
  else if (url.includes("/versions/"))
    result = {
      annotations: { "workers/tag": snapshot.sha },
      resources: {
        bindings: baseBindings.map((binding) =>
          binding.name === "LEVI_EMAIL_FROM"
            ? { ...binding, text: snapshot.from }
            : binding,
        ),
      },
    };
  else return undefined;
  return Response.json({ success: true, result });
}

void test("primeiro corte permite noreply apenas no UUID/SHA original e publica hi estritamente", async () => {
  for (const previous of [
    originalTransferVersion,
    { ...originalTransferVersion, from: valid.LEVI_EMAIL_FROM },
  ]) {
    const result = await simulatedDeploy({
      respond: (url, published) =>
        transferResponse(url, published ? foundationTransferVersion : previous),
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(result.uploads, 1);
    assert.equal(result.cleanups, 1);
    assert.equal(result.writes.length, 2);
    assert.ok(!result.output.includes(valid.CLOUDFLARE_API_TOKEN));
  }
});

void test("corte recusa remetente anterior inesperado e não estende exceção para outra versão/SHA", async () => {
  for (const previous of [
    {
      ...originalTransferVersion,
      from: "Levi <private-sender@unexpected.example>",
    },
    { ...originalTransferVersion, id: previousVersionId },
    { ...originalTransferVersion, sha: "f".repeat(40) },
  ]) {
    const result = await simulatedDeploy({
      respond: (url, published) =>
        transferResponse(url, published ? foundationTransferVersion : previous),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.equal(result.writes.length, 0);
    assert.ok(!result.output.includes("private-sender"));
  }
});

void test("corte detecta troca de remetente entre snapshots mesmo com UUID/SHA iguais", async () => {
  let reads = 0;
  const result = await simulatedDeploy({
    respond: (url, published) => {
      if (!published && url.includes("/versions/")) reads++;
      return transferResponse(
        url,
        published
          ? foundationTransferVersion
          : {
              ...originalTransferVersion,
              from:
                reads > 1
                  ? valid.LEVI_EMAIL_FROM
                  : originalTransferVersion.from,
            },
      );
    },
  });
  assert.equal(reads, 2);
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 0);
});

void test("pós-upload recusa noreply e terceiros, sem repetir upload ou usar a exceção inicial", async () => {
  for (const from of [
    originalTransferVersion.from,
    "Levi <private-sender@unexpected.example>",
  ]) {
    const result = await simulatedDeploy({
      respond: (url, published) =>
        transferResponse(
          url,
          published
            ? { ...foundationTransferVersion, from }
            : originalTransferVersion,
        ),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 1);
    assert.equal(result.cleanups, 1);
    assert.ok(!result.output.includes(from));
  }
});

void test("compatibilidade inicial mantém Assets, secrets e recursos obrigatórios", () => {
  const legacyBindings = baseBindings.map((binding) =>
    binding.name === "LEVI_EMAIL_FROM"
      ? { ...binding, text: originalTransferVersion.from }
      : binding,
  );
  for (const missing of [
    "ASSETS",
    "LEVI_AUTH_SECRET",
    "RESEND_API_KEY",
    "LEVI_PUBLIC_ORIGIN",
    "HYPERDRIVE",
  ]) {
    assert.throws(() =>
      verifyPreviousWorkerBindings(
        {
          resources: {
            bindings: legacyBindings.filter(
              (binding) => binding.name !== missing,
            ),
          },
        },
        valid,
        {
          versionId: originalTransferVersion.id,
          sha: originalTransferVersion.sha,
        },
      ),
    );
  }
});

void test("Resend ausente falha antes de CI, leitura remota e upload, sem fallback", async () => {
  for (const key of [undefined, "", "   "]) {
    const result = await simulatedDeploy({ env: { RESEND_API_KEY: key } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.requests.length, 0);
    assert.equal(result.ciCalls, 0);
    assert.equal(result.writes.length, 0);
    assert.equal(result.uploads, 0);
  }
});

void test("secrets recusam disco persistente e falha de escrita, limpando sem upload", async () => {
  for (const failure of [
    { memoryType: 0xef53 },
    { secretWriteError: new Error(sensitive) },
  ]) {
    const result = await simulatedDeploy(failure);
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.equal(result.cleanups, "memoryType" in failure ? 0 : 1);
    assert.deepEqual(result.secretNames, []);
    assert.ok(!result.output.includes("private-"));
    assert.ok(!result.output.includes(valid.RESEND_API_KEY));
  }
});

void test("falha Wrangler não vaza secrets nem saída bruta e não tenta publicar novamente", async () => {
  const result = await simulatedDeploy({
    uploadError: new Error(
      valid.RESEND_API_KEY +
        valid.LEVI_AUTH_SECRET +
        valid.LEVI_ADMIN_EMAIL +
        sensitive,
    ),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 1);
  assert.equal(result.cleanups, 1);
  assert.ok(!result.output.includes(valid.RESEND_API_KEY));
  assert.ok(!result.output.includes(valid.AUTH_SECRET));
  assert.ok(!result.output.includes("private-"));
});

void test("workflow recebe somente nomes canônicos no publish do Environment, sem AUTH_SECRET legado", async () => {
  const workflow = await readFile(
    "../../.github/workflows/deploy-levi-dev.yml",
    "utf8",
  );
  assert.ok(workflow.includes("environment: levi-dev"));
  const input = "RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}";
  assert.equal(workflow.split(input).length - 1, 1);
  assert.ok(workflow.indexOf(input) > workflow.indexOf("id: publish"));
  assert.ok(!workflow.includes("secrets.AUTH_SECRET"));
  const authentication = "LEVI_AUTH_SECRET: ${{ secrets.LEVI_AUTH_SECRET }}";
  assert.equal(workflow.split(authentication).length - 1, 1);
  assert.ok(workflow.indexOf(authentication) > workflow.indexOf("id: publish"));
});

void test("Wrangler fixado aceita secrets em tmpfs no mesmo deploy dry-run, sem vazamento", async () => {
  assert.equal((await statfs("/dev/shm")).type, 0x01021994);
  const directory = await mkdtemp("/dev/shm/levi-dev-wrangler-test-");
  const key = "synthetic-resend-dry-run-not-real";
  const authKey = "synthetic-auth-dry-run-more-than-32-characters";
  const adminEmail = "synthetic-admin-dry-run@example.test";
  try {
    await writeFile(
      join(directory, "worker.mjs"),
      'export default { fetch() { return new Response("synthetic"); } };',
    );
    await writeFile(
      join(directory, "wrangler.json"),
      JSON.stringify({
        name: "levi-dev-synthetic-only",
        main: "worker.mjs",
        compatibility_date: "2025-09-01",
        secrets: {
          required: ["RESEND_API_KEY", "LEVI_AUTH_SECRET", "LEVI_ADMIN_EMAIL"],
        },
      }),
    );
    await writeFile(
      join(directory, "secrets.json"),
      JSON.stringify({
        RESEND_API_KEY: key,
        LEVI_AUTH_SECRET: authKey,
        LEVI_ADMIN_EMAIL: adminEmail,
      }),
      { mode: 0o600, flag: "wx" },
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/wrangler/bin/wrangler.js"),
        "deploy",
        "--config",
        join(directory, "wrangler.json"),
        "--secrets-file",
        join(directory, "secrets.json"),
        "--dry-run",
        "--outdir",
        join(directory, "out"),
        "--strict",
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          CI: "true",
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_WRITE_LOGS: "false",
          WRANGLER_LOG_SANITIZE: "true",
        },
      },
    );
    const output = String(result.stdout) + String(result.stderr);
    assert.equal(result.status, 0, output.replaceAll(key, "[redacted]"));
    assert.ok(!output.includes(key));
    assert.ok(!output.includes(authKey));
    assert.ok(!output.includes(adminEmail));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("entradas internas ausentes bloqueiam mesmo com configurações legadas preenchidas", async () => {
  const legacy = {
    EMAIL_FROM: valid.LEVI_EMAIL_FROM,
    HYPERDRIVE_ID: valid.LEVI_HYPERDRIVE_ID,
    DATABASE_HOST: valid.LEVI_DEV_DATABASE_HOST,
    DATABASE_NAME: valid.LEVI_DEV_DATABASE_NAME,
    DEPLOY_READY: "true",
  };
  for (const internal of [
    "LEVI_EMAIL_FROM",
    "LEVI_HYPERDRIVE_ID",
    "LEVI_DEV_DATABASE_HOST",
    "LEVI_DEV_DATABASE_NAME",
    "LEVI_DEV_READY",
  ]) {
    const result = await simulatedDeploy({
      env: { ...legacy, [internal]: undefined },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.requests.length, 0);
    assert.equal(result.ciCalls, 0);
    assert.equal(result.uploads, 0);
    assert.equal(result.writes.length, 0);
    assert.ok(!result.output.includes(valid.LEVI_AUTH_SECRET));
    assert.ok(!result.output.includes(valid.RESEND_API_KEY));
  }
});

void test("LEVI_AUTH_SECRET ausente ou curto bloqueia antes de I/O mesmo com AUTH_SECRET legado", async () => {
  for (const value of [undefined, "", "   ", "x".repeat(31)]) {
    const result = await simulatedDeploy({
      env: { LEVI_AUTH_SECRET: value, AUTH_SECRET: valid.LEVI_AUTH_SECRET },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.requests.length, 0);
    assert.equal(result.ciCalls, 0);
    assert.equal(result.uploads, 0);
    assert.equal(result.writes.length, 0);
    assert.ok(!result.output.includes(valid.LEVI_AUTH_SECRET));
  }
});

void test("e-mail administrativo é privado, normalizado e sobrescrito para negar quando ausente/inválido", async () => {
  for (const configured of [
    undefined,
    "",
    " ",
    "invalid",
    "a@example.test,b@example.test",
    "  SYNTHETIC-PRIVATE-ADMIN@EXAMPLE.TEST  ",
  ]) {
    const result = await simulatedDeploy({
      env: { LEVI_ADMIN_EMAIL: configured },
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(result.uploads, 1);
    assert.ok(!result.output.includes(valid.LEVI_ADMIN_EMAIL));
    if (configured?.trim()) assert.ok(!result.output.includes(configured));
  }
  const workflow = await readFile(
    "../../.github/workflows/deploy-levi-dev.yml",
    "utf8",
  );
  assert.equal(workflow.split("${{ secrets.LEVI_ADMIN_EMAIL }}").length - 1, 1);
  const diagnostic = await readFile(
    "../../.github/workflows/diagnose-levi-cloudflare.yml",
    "utf8",
  );
  assert.ok(!diagnostic.includes("LEVI_ADMIN_EMAIL"));
});

void test("publicação exige o binding administrativo privado sem bloquear versões anteriores que não o possuem", async () => {
  const withoutAdmin = baseBindings.filter(
    (binding) => binding.name !== "LEVI_ADMIN_EMAIL",
  );
  for (const failPublished of [false, true]) {
    const result = await simulatedDeploy({
      respond: (url, published) => {
        if (url.includes("/versions/") && (!published || failPublished))
          return Response.json({
            success: true,
            result: {
              annotations: {
                "workers/tag": published ? valid.GITHUB_SHA : "e".repeat(40),
              },
              resources: { bindings: withoutAdmin },
            },
          });
        return undefined;
      },
    });
    assert.equal(result.uploads, 1);
    assert.equal(result.exitCode, failPublished ? 1 : 0, result.output);
    assert.ok(!result.output.includes(valid.LEVI_ADMIN_EMAIL));
  }
});

void test("capacidade temporária só acompanha os seis GETs finais, sem segredo no upload ou logs", async () => {
  const capability = "f".repeat(64);
  const paths: string[] = [];
  const result = await simulatedDeploy({
    env: { LEVI_MAINTENANCE_SMOKE: "true", LEVI_SMOKE_CAPABILITY: capability },
    inspectRequest(url, init) {
      const headers = new Headers(init.headers);
      if (new URL(url).origin === "https://levi.t00ls.dev") {
        paths.push(new URL(url).pathname);
        assert.equal(headers.get("X-Levi-Smoke-Capability"), capability);
        assert.equal(headers.has("Cookie"), false);
        assert.equal(headers.has("Authorization"), false);
        assert.equal(init.redirect, "manual");
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(new URL(url).search, "");
      } else assert.equal(headers.has("X-Levi-Smoke-Capability"), false);
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.uploads, 1);
  assert.deepEqual(paths, [
    "/",
    "/admin",
    "/api/admin/session",
    "/api/onboarding",
    "/api/churches",
    "/api/members",
  ]);
  assert.ok(!result.output.includes(capability));
});

void test("manutenção sem capacidade falha antes de qualquer I/O; normal ignora capacidade residual", async () => {
  for (const value of [
    undefined,
    "",
    "short",
    "g".repeat(64),
    "f".repeat(64) + "\r\n",
  ]) {
    const result = await simulatedDeploy({
      env: { LEVI_MAINTENANCE_SMOKE: "true", LEVI_SMOKE_CAPABILITY: value },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.deepEqual(result.requests, []);
    assert.deepEqual(result.writes, []);
    assert.ok(!result.output.includes("AssertionError"));
  }
  const result = await simulatedDeploy({
    env: {
      LEVI_MAINTENANCE_SMOKE: "false",
      LEVI_SMOKE_CAPABILITY: "f".repeat(64),
    },
    inspectRequest(_url, init) {
      assert.equal(
        new Headers(init.headers).has("X-Levi-Smoke-Capability"),
        false,
      );
    },
  });
  assert.equal(result.exitCode, 0);
  for (const status of [302, 403, 503]) {
    const blocked = await simulatedDeploy({
      env: {
        LEVI_MAINTENANCE_SMOKE: "true",
        LEVI_SMOKE_CAPABILITY: "f".repeat(64),
      },
      respond: (url) =>
        new URL(url).hostname === "levi.t00ls.dev"
          ? new Response(null, { status })
          : undefined,
    });
    assert.equal(blocked.exitCode, 1);
    assert.equal(blocked.uploads, 1);
  }
});
