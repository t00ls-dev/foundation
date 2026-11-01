import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import { diagnoseCloudflare } from "./levi-cloudflare-read.mjs";

const secret = "canary-private-credential-never-print-this-value";
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const deploymentId = "44444444-4444-4444-8444-444444444444";
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "t00ls-dev/foundation",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/master",
  GITHUB_SHA: "9".repeat(40),
  LEVI_DIAGNOSTIC_SHA: "9".repeat(40),
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_TOKEN: secret,
  CLOUDFLARE_ZONE_ID: "b".repeat(32),
  LEVI_HYPERDRIVE_ID: "c".repeat(32),
  LEVI_DEV_DATABASE_HOST: "ep-synthetic.us-east-2.aws.neon.tech",
  LEVI_DEV_DATABASE_NAME: "levi_dev",
};
const envelope = (result) => Response.json({ success: true, result });
const deployment = (
  versions = [{ version_id: ids[0], percentage: 100 }],
  id = deploymentId,
) => ({ deployments: [{ id, versions }] });
function version(id, tag = "8".repeat(40)) {
  return {
    id,
    annotations: { "workers/tag": tag, "workers/message": secret },
    resources: {
      bindings: [
        { name: "ASSETS", type: "assets" },
        { name: "HYPERDRIVE", type: "hyperdrive", id: env.LEVI_HYPERDRIVE_ID },
        { name: "LEVI_AUTH_SECRET", type: "secret_text", text: secret },
        { name: "RESEND_API_KEY", type: "secret_text", text: secret },
        {
          name: "LEVI_PUBLIC_ORIGIN",
          type: "plain_text",
          text: "https://levi.t00ls.dev",
        },
        {
          name: "LEVI_MEMBERS_DEV_ORGANIZATIONS",
          type: "plain_text",
          text: secret,
        },
      ],
    },
    metadata: { author_email: secret },
  };
}
async function simulate({ changes = {}, respond = () => undefined } = {}) {
  const configuration = { ...env, ...changes };
  const requests = [];
  const report = await diagnoseCloudflare(
    configuration,
    async (input, init) => {
      const url = new URL(input);
      assert.equal(url.origin, "https://api.cloudflare.com");
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(
        init.headers.Authorization,
        `Bearer ${configuration.CLOUDFLARE_API_TOKEN}`,
      );
      requests.push(url);
      const override = respond(url, requests);
      if (override) return override;
      if (url.pathname.endsWith("/tokens/verify"))
        return envelope({ id: secret, status: "active", private: secret });
      if (url.pathname.includes("/hyperdrive/configs/"))
        return envelope({
          id: env.LEVI_HYPERDRIVE_ID,
          name: "levi-dev",
          origin: {
            host: env.LEVI_DEV_DATABASE_HOST,
            database: "levi_dev",
            user: "levi_dev_runtime",
            password: secret,
          },
          caching: { disabled: true },
          mtls: { sslmode: "verify-full" },
        });
      if (url.pathname.endsWith("/subdomain"))
        return envelope({ enabled: false, previews_enabled: false });
      if (url.pathname.endsWith("/workers/domains")) {
        assert.equal(url.searchParams.get("hostname"), "levi.t00ls.dev");
        return envelope([
          {
            hostname: "levi.t00ls.dev",
            service: "levi-dev",
            zone_id: env.CLOUDFLARE_ZONE_ID,
            enabled: true,
            previews_enabled: false,
          },
        ]);
      }
      if (url.pathname.endsWith("/workers/routes"))
        return envelope([
          { script: "levi-dev", pattern: secret },
          { script: secret, pattern: secret },
        ]);
      if (url.pathname.startsWith("/client/v4/zones/"))
        return envelope({
          id: env.CLOUDFLARE_ZONE_ID,
          name: "t00ls.dev",
          account: { id: env.CLOUDFLARE_ACCOUNT_ID },
        });
      if (url.pathname.endsWith("/deployments")) return envelope(deployment());
      if (url.pathname.endsWith("/versions")) {
        assert.equal(url.searchParams.get("per_page"), "5");
        return envelope({
          items: ids.map((id) => ({ id, metadata: { author_email: secret } })),
        });
      }
      if (url.pathname.includes("/versions/"))
        return envelope(version(url.pathname.split("/").at(-1)));
      throw new Error(secret);
    },
  );
  assert.ok(
    !JSON.stringify(report).includes(
      configuration.CLOUDFLARE_API_TOKEN || secret,
    ),
  );
  assert.ok(
    !JSON.stringify(report).includes(configuration.CLOUDFLARE_ACCOUNT_ID),
  );
  assert.ok(!JSON.stringify(report).includes("author_email"));
  return { report, requests };
}
const check = (report, name) =>
  report.checks.find((entry) => entry.check === name);

test("diagnóstico só aceita contexto manual da master, SHA exato e configuração válida", async () => {
  for (const changes of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REPOSITORY: "unrelated/levi" },
    { GITHUB_EVENT_NAME: "workflow_run" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REF: "refs/tags/master" },
    { GITHUB_SHA: "invalid" },
    { LEVI_DIAGNOSTIC_SHA: "0".repeat(40) },
    { CLOUDFLARE_API_TOKEN: "" },
    { CLOUDFLARE_API_TOKEN: " " + secret },
    { CLOUDFLARE_API_TOKEN: "short" },
    { CLOUDFLARE_ACCOUNT_ID: "../other" },
    { CLOUDFLARE_ZONE_ID: "invalid" },
    { LEVI_HYPERDRIVE_ID: "https://private.invalid" },
    { LEVI_DEV_DATABASE_NAME: "production" },
  ]) {
    const { report, requests } = await simulate({ changes });
    assert.equal(report.ok, false);
    assert.equal(report.checks[0].outcome, "invalid_configuration");
    assert.equal(requests.length, 0);
  }
});

test("GETs e projeções sanitizadas identificam versão ativa, última e anteriores sem payload privado", async () => {
  const { report, requests } = await simulate();
  assert.equal(report.ok, true);
  assert.equal(report.stableSnapshot, true);
  assert.equal(report.activeIsLatest, true);
  assert.deepEqual(check(report, "deployment").metadata, {
    id: deploymentId,
    traffic: [{ id: ids[0], percentage: 100 }],
  });
  assert.deepEqual(check(report, "recent_versions").metadata.ids, ids);
  assert.equal(
    report.checks.filter((entry) => entry.check === "version").length,
    3,
  );
  assert.equal(check(report, "version").metadata.assets, true);
  assert.equal(check(report, "hyperdrive").metadata.runtimeRole, true);
  assert.equal(requests.length, 13);
  for (const url of requests)
    assert.ok(
      !/deploy|restore|rollback|secret/.test(url.pathname) ||
        url.pathname.endsWith("/deployments"),
    );
});

test("User API Token usa rota fixa, sem fallback por 401/403", async () => {
  const success = await simulate();
  assert.equal(success.report.tokenType, "user");
  assert.equal(success.requests[0].pathname, "/client/v4/user/tokens/verify");
  const { report, requests } = await simulate({
    respond: (url) =>
      url.pathname.endsWith("/tokens/verify")
        ? new Response(secret, { status: 403 })
        : undefined,
  });
  assert.equal(check(report, "authentication").outcome, "forbidden");
  assert.equal(check(report, "hyperdrive").outcome, "ok");
  assert.equal(report.ok, false);
  assert.equal(
    requests.filter((url) => url.pathname.endsWith("/tokens/verify")).length,
    1,
  );
});

test("401, 403, 404 e falhas transitórias são distintos e não geram retries", async () => {
  for (const [status, outcome] of [
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [429, "transient_http"],
    [503, "transient_http"],
    [302, "unexpected_http"],
  ]) {
    const { report, requests } = await simulate({
      respond: (url) =>
        url.pathname.includes("/hyperdrive/configs/")
          ? new Response(secret, { status })
          : undefined,
    });
    assert.deepEqual(check(report, "hyperdrive"), {
      check: "hyperdrive",
      outcome,
      http: status,
    });
    assert.equal(report.ok, false);
    assert.equal(check(report, "zone").outcome, "ok");
    assert.equal(
      requests.filter((url) => url.pathname.includes("/hyperdrive/configs/"))
        .length,
      1,
    );
  }
});

test("JSON inválido e envelope ou forma incompletos falham sem corpo/erro privado", async () => {
  for (const response of [
    new Response(secret),
    Response.json({ success: false, message: secret }),
    envelope(null),
    envelope({ private: secret }),
  ]) {
    const { report } = await simulate({
      respond: (url) =>
        url.pathname.includes("/hyperdrive/configs/") ? response : undefined,
    });
    assert.equal(report.ok, false);
    assert.equal(check(report, "hyperdrive").outcome, "unexpected_response");
  }
});

test("timeout/rede não são confundidos com credencial inválida nem expõem exceções", async () => {
  const { report } = await simulate({
    respond: (url) => {
      if (url.pathname.includes("/hyperdrive/configs/"))
        throw new DOMException(secret, "TimeoutError");
    },
  });
  assert.equal(check(report, "hyperdrive").outcome, "network_error");
  assert.equal(report.ok, false);
});

test("autenticação exige status active, não apenas HTTP 200", async () => {
  for (const status of ["expired", "disabled", secret]) {
    const { report } = await simulate({
      respond: (url) =>
        url.pathname.endsWith("/tokens/verify")
          ? envelope({ status })
          : undefined,
    });
    assert.equal(report.ok, false);
    assert.equal(
      check(report, "authentication").outcome,
      status === secret ? "unexpected_response" : "inactive",
    );
  }
});

test("IDs remotos inválidos não entram em URLs e dados que coincidam com credencial não são emitidos", async () => {
  const { report, requests } = await simulate({
    respond: (url) =>
      url.pathname.endsWith("/versions")
        ? envelope({ items: [{ id: "../../private" }] })
        : undefined,
  });
  assert.equal(check(report, "recent_versions").outcome, "unexpected_response");
  assert.ok(requests.every((url) => !url.pathname.includes("private")));
  const credential = "8".repeat(40);
  const result = await simulate({
    changes: { CLOUDFLARE_API_TOKEN: credential },
  });
  assert.equal(check(result.report, "version").metadata.sha, null);
});

test("distribuição gradual é registrada sem fingir versão única ou prontidão de deploy", async () => {
  for (const percentage of [0, 40]) {
    const { report } = await simulate({
      respond: (url) =>
        url.pathname.endsWith("/deployments")
          ? envelope(
              deployment([
                { version_id: ids[0], percentage: 100 - percentage },
                { version_id: ids[1], percentage },
              ]),
            )
          : undefined,
    });
    assert.equal(report.ok, true);
    assert.equal(report.activeIsLatest, null);
    assert.equal(check(report, "deployment").metadata.traffic.length, 2);
  }
});

test("versão enviada sem tráfego é distinguida da ativa e não é apresentada como recuperação homologada", async () => {
  const { report } = await simulate({
    respond: (url) =>
      url.pathname.endsWith("/versions")
        ? envelope({ items: [ids[1], ids[0], ids[2]].map((id) => ({ id })) })
        : undefined,
  });
  assert.equal(report.ok, true);
  assert.equal(report.activeIsLatest, false);
  assert.equal(report.stableSnapshot, true);
  assert.ok(!JSON.stringify(report).includes("recoverable"));
});

test("mudança de deployment durante as leituras impede confirmar snapshot estável sem repetir", async () => {
  let reads = 0;
  const { report, requests } = await simulate({
    respond: (url) => {
      if (url.pathname.endsWith("/deployments") && ++reads === 2)
        return envelope(
          deployment([{ version_id: ids[1], percentage: 100 }], ids[2]),
        );
    },
  });
  assert.equal(report.stableSnapshot, false);
  assert.equal(report.ok, false);
  assert.equal(
    requests.filter((url) => url.pathname.endsWith("/deployments")).length,
    2,
  );
});

test("workflow manual só usa código integrado da master e secrets do Environment levi-dev", () => {
  const workflow = parse(
    readFileSync(
      new URL("../workflows/diagnose-levi-cloudflare.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.on.workflow_dispatch, null);
  assert.deepEqual(Object.keys(workflow.jobs), ["diagnose"]);
  const job = workflow.jobs.diagnose;
  assert.equal(job.environment, "levi-dev");
  assert.equal(job["timeout-minutes"], 5);
  const trusted = {
    github: {
      repository: "t00ls-dev/foundation",
      event_name: "workflow_dispatch",
      ref: "refs/heads/master",
      sha: env.GITHUB_SHA,
    },
    inputs: { execution_sha: env.GITHUB_SHA },
  };
  assert.equal(runInNewContext(job.if, trusted), true);
  for (const changes of [
    { repository: "unrelated/levi" },
    { event_name: "pull_request" },
    { event_name: "workflow_run" },
    { ref: "refs/heads/feature" },
  ])
    assert.equal(
      runInNewContext(job.if, {
        ...trusted,
        github: { ...trusted.github, ...changes },
      }),
      false,
    );
  assert.equal(job.steps.length, 3);
  assert.equal(job.steps[0].with.ref, "${{ github.sha }}");
  assert.equal(job.steps[0].with["persist-credentials"], false);
  assert.deepEqual(job.steps[1], {
    uses: "actions/setup-node@v7",
    with: { "node-version": "22.23.3" },
  });
  const diagnostic = job.steps[2];
  for (const [internal, canonical] of Object.entries({
    LEVI_HYPERDRIVE_ID: "LEVI_HYPERDRIVE_ID",
    LEVI_DEV_DATABASE_HOST: "LEVI_DATABASE_HOST",
    LEVI_DEV_DATABASE_NAME: "LEVI_DATABASE_NAME",
  }))
    assert.equal(diagnostic.env[internal], "${{ vars." + canonical + " }}");
  assert.equal(diagnostic.run, "node .github/scripts/levi-cloudflare-read.mjs");
  assert.deepEqual(
    Object.values(diagnostic.env).filter((value) => value.includes("secrets.")),
    [
      "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    ],
  );
  for (const step of job.steps.slice(0, 2))
    assert.ok(!JSON.stringify(step).includes("secrets."));
  const text = JSON.stringify(workflow);
  for (const forbidden of [
    "deploy:dev",
    "wrangler",
    "pnpm",
    "artifact",
    "cache",
    "DEPLOY_READY",
    "CLOUDFLARE_READ_TOKEN",
    "RESEND_API_KEY",
    "DATABASE_URL",
  ])
    assert.ok(!text.includes(forbidden), forbidden);
});

test("CLI sem contexto autorizado encerra antes de rede e emite somente JSON sanitizado", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./levi-cloudflare-read.mjs", import.meta.url))],
    {
      encoding: "utf8",
      env: {
        CLOUDFLARE_API_TOKEN: secret,
        CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.checks[0].outcome, "invalid_configuration");
  assert.ok(!(result.stdout + result.stderr).includes(secret));
  assert.ok(
    !(result.stdout + result.stderr).includes(env.CLOUDFLARE_ACCOUNT_ID),
  );
});

test("metadados incompletos não são confundidos com configuração comprovada", async () => {
  for (const [path, name, payload] of [
    [
      "/hyperdrive/configs/",
      "hyperdrive",
      { id: env.LEVI_HYPERDRIVE_ID, origin: {} },
    ],
    [
      "/workers/domains",
      "domain",
      [{ hostname: "levi.t00ls.dev", enabled: true, previews_enabled: false }],
    ],
    ["/workers/routes", "routes", [{}]],
    ["/zones/", "zone", {}],
    ["/versions/", "version", { id: ids[0], resources: { bindings: [{}] } }],
  ]) {
    const { report } = await simulate({
      respond: (url) =>
        url.pathname.includes(path) ? envelope(payload) : undefined,
    });
    assert.equal(check(report, name).outcome, "unexpected_response");
    assert.equal(report.ok, false);
  }
  const { report } = await simulate({
    respond: (url) =>
      url.pathname.includes("/hyperdrive/configs/")
        ? envelope({
            id: env.LEVI_HYPERDRIVE_ID,
            name: "levi-dev",
            origin: {
              host: env.LEVI_DEV_DATABASE_HOST,
              database: "levi_dev",
              user: "levi_dev_runtime",
            },
          })
        : undefined,
  });
  assert.equal(check(report, "hyperdrive").metadata.cacheDisabled, null);
  assert.equal(check(report, "hyperdrive").metadata.tlsVerifyFull, null);
});

test("diagnóstico rejeita variable canônica ausente mesmo com aliases legados e sem consultar API", async () => {
  const workflow = parse(
    readFileSync(
      new URL("../workflows/diagnose-levi-cloudflare.yml", import.meta.url),
      "utf8",
    ),
  );
  const configured = workflow.jobs.diagnose.steps[2].env;
  const variables = {
    CLOUDFLARE_ZONE_ID: env.CLOUDFLARE_ZONE_ID,
    LEVI_HYPERDRIVE_ID: env.LEVI_HYPERDRIVE_ID,
    LEVI_DATABASE_HOST: env.LEVI_DEV_DATABASE_HOST,
    LEVI_DATABASE_NAME: env.LEVI_DEV_DATABASE_NAME,
    HYPERDRIVE_ID: env.LEVI_HYPERDRIVE_ID,
    DATABASE_HOST: env.LEVI_DEV_DATABASE_HOST,
    DATABASE_NAME: env.LEVI_DEV_DATABASE_NAME,
  };
  for (const missing of [
    undefined,
    "LEVI_HYPERDRIVE_ID",
    "LEVI_DATABASE_HOST",
    "LEVI_DATABASE_NAME",
  ]) {
    const vars = { ...variables };
    if (missing) delete vars[missing];
    const context = {
      vars,
      secrets: {
        CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
      },
      github: { sha: env.GITHUB_SHA },
    };
    const changes = Object.fromEntries(
      Object.entries(configured).map(([key, expression]) => [
        key,
        runInNewContext(expression.slice(3, -2), context) ?? "",
      ]),
    );
    const { report, requests } = await simulate({ changes });
    assert.equal(report.ok, !missing);
    if (missing) {
      assert.equal(report.checks[0].outcome, "invalid_configuration");
      assert.equal(requests.length, 0);
    }
  }
});
