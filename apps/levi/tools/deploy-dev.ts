import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { administrativeEmail } from "../src/admin-config.js";
import {
  deploySettings,
  verifyHyperdrive,
  verifyWorkerBindings,
  verifyPreviousWorkerBindings,
  deploymentConfig,
  deployOrigin,
  deployWorker,
} from "./deploy-config.js";
import { requireSuccessfulCI } from "./ci-evidence.js";
import { DeployDiagnostics } from "./deploy-diagnostics.js";
import type { DeployCheck } from "./deploy-diagnostics.js";

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

// Nenhuma migration, criação de banco/Hyperdrive ou alteração de plano.
const diagnostics = new DeployDiagnostics((message) => console.info(message));
let directory: string | undefined;
try {
  const env = process.env;
  const settings = diagnostics.verify("configuration", () =>
    deploySettings(env),
  );
  diagnostics.phase = "ci";
  const ci = await requireSuccessfulCI(env, fetch, diagnostics);
  async function currentMain() {
    const response = await diagnostics.request("main-read", () =>
      fetch(
        "https://api.github.com/repos/t00ls-dev/foundation/git/ref/heads/master",
        {
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      ),
    );
    diagnostics.httpOk(response);
    const main = (await response.json()) as { object?: { sha?: string } };
    diagnostics.inspect("main-sha");
    assert.equal(main.object?.sha, settings.sha);
    diagnostics.start("local-head", "falha de operação local");
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    diagnostics.start("local-head");
    assert.equal(head, settings.sha);
    diagnostics.start("local-clean", "falha de operação local");
    const clean = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      { encoding: "utf8" },
    ).trim();
    diagnostics.start("local-clean");
    assert.equal(clean, "");
  }
  await currentMain();
  const account = `/accounts/${settings.account}`;
  async function cloudflare(
    check: DeployCheck,
    path: string,
  ): Promise<unknown> {
    const response = await diagnostics.request(check, () =>
      fetch(`https://api.cloudflare.com/client/v4${path}`, {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      }),
    );
    diagnostics.httpOk(response);
    const body = (await response.json()) as {
      success?: unknown;
      result?: unknown;
    };
    assert.equal(body.success, true);
    return body.result;
  }
  async function list(
    check: "domains-read" | "routes-read",
    shape: "domains-shape" | "routes-shape",
    path: string,
  ): Promise<Record<string, unknown>[]> {
    const entries: Record<string, unknown>[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await cloudflare(
        check,
        `${path}?page=${page}&per_page=100`,
      );
      diagnostics.inspect(shape, "resposta inesperada");
      const pageEntries = asRecordArray(result);
      entries.push(...pageEntries);
      if (pageEntries.length < 100) return entries;
    }
    diagnostics.start("pagination-limit", "resposta inesperada");
    throw new Error();
  }
  diagnostics.phase = "protections";
  async function protections() {
    const hyperdrive = await cloudflare(
      "hyperdrive-read",
      `${account}/hyperdrive/configs/${settings.hyperdrive}`,
    );
    diagnostics.verify("hyperdrive", () => verifyHyperdrive(hyperdrive, env));
    const alternate = asRecord(
      await cloudflare(
        "subdomain-read",
        `${account}/workers/scripts/${deployWorker}/subdomain`,
      ),
    );
    diagnostics.inspect("subdomain");
    assert.equal(alternate.enabled, false);
    assert.equal(alternate.previews_enabled, false);
    const domains = await list(
      "domains-read",
      "domains-shape",
      `${account}/workers/domains`,
    );
    diagnostics.inspect("domains");
    assert.equal(
      domains.filter(
        (domain) => domain.hostname === new URL(deployOrigin).hostname,
      ).length,
      1,
    );
    for (const domain of domains) {
      if (domain.hostname === new URL(deployOrigin).hostname) {
        assert.equal(domain.service, deployWorker);
        assert.equal(domain.enabled, true);
        assert.equal(domain.previews_enabled, false);
      }
      if (domain.service === deployWorker)
        assert.equal(domain.hostname, new URL(deployOrigin).hostname);
    }
    // Sem rotas legadas alternativas na zona de publicação.
    const zones = domains
      .filter((domain) => domain.service === deployWorker)
      .map((domain) => domain.zone_id);
    const zoneId = env.CLOUDFLARE_ZONE_ID;
    diagnostics.start("zone-id");
    assert.match(zoneId ?? "", /^[a-f0-9]{32}$/);
    const zone = asRecord(await cloudflare("zone-read", `/zones/${zoneId}`));
    diagnostics.inspect("zone");
    assert.equal(zone.name, "t00ls.dev");
    assert.equal(asRecord(zone.account).id, settings.account);
    assert.ok(zones.every((id) => id === zoneId));
    const routes = await list(
      "routes-read",
      "routes-shape",
      `/zones/${zoneId}/workers/routes`,
    );
    diagnostics.inspect("routes");
    assert.ok(routes.every((route) => route.script !== deployWorker));
  }
  await protections();
  async function activeVersion(phase: "previous" | "published") {
    type Snapshot = {
      versionId: string;
      sha: string;
      listed: boolean;
      version: Record<string, unknown>;
    };
    async function read(): Promise<Snapshot> {
      const deployments = asRecord(
        await cloudflare(
          "deployments-read",
          `${account}/workers/scripts/${deployWorker}/deployments`,
        ),
      );
      diagnostics.inspect("deployment-shape", "resposta inesperada");
      const deployment = asRecordArray(deployments.deployments)[0];
      assert.ok(deployment);
      const versions = asRecordArray(deployment.versions);
      diagnostics.inspect("deployment-traffic");
      assert.equal(versions.length, 1);
      const versionEntry = versions[0];
      assert.ok(versionEntry);
      assert.equal(versionEntry.percentage, 100);
      const versionId = versionEntry.version_id;
      assert.ok(typeof versionId === "string");
      assert.match(
        versionId,
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
      );
      // A lista confirma a presença da versão ativa pelo ID; ordem e posição
      // não provam identidade nem um estado atômico entre endpoints.
      const uploaded = asRecord(
        await cloudflare(
          "versions-read",
          `${account}/workers/scripts/${deployWorker}/versions`,
        ),
      );
      // Wrangler herda secrets da última versão enviada no preflight.
      // Preserve essa proteção separada da identificação da versão ativa.
      if (phase === "previous") {
        diagnostics.inspect("version-inheritance");
        assert.equal(asRecordArray(uploaded.items)[0]?.id, versionId);
      }
      diagnostics.inspect("version-latest");
      const listed = asRecordArray(uploaded.items).some(
        (item) => item.id === versionId,
      );
      const version = asRecord(
        await cloudflare(
          "version-read",
          `${account}/workers/scripts/${deployWorker}/versions/${versionId}`,
        ),
      );
      diagnostics.inspect("version-tag");
      const sha = asRecord(version.annotations)["workers/tag"];
      assert.ok(typeof sha === "string");
      assert.match(sha, /^[a-f0-9]{40}$/);
      return { versionId, sha, listed, version };
    }
    function confirm(snapshot: Snapshot) {
      return diagnostics.verify("version-binding", () => {
        if (phase === "previous")
          return verifyPreviousWorkerBindings(snapshot.version, env, {
            versionId: snapshot.versionId,
            sha: snapshot.sha,
          });
        verifyWorkerBindings(snapshot.version, env);
        if (phase === "published") {
          const matches = asRecordArray(
            asRecord(snapshot.version.resources).bindings,
          ).filter((binding) => binding.name === "LEVI_ADMIN_EMAIL");
          assert.equal(matches.length, 1);
          const match = matches[0];
          assert.ok(match);
          assert.equal(match.type, "secret_text");
        }
        return "current";
      });
    }
    const expectedSha = phase === "published" ? settings.sha : undefined;
    const converged = (snapshot: Snapshot) =>
      snapshot.listed &&
      (expectedSha === undefined || snapshot.sha === expectedSha);
    const first = await read();
    if (converged(first)) {
      const sender = confirm(first);
      return { versionId: first.versionId, sha: first.sha, sender };
    }
    // Divergência transitória entre endpoints: somente releituras limitadas,
    // sem republicar, exigindo ID e tag estáveis em leituras consecutivas.
    const attempts = 6;
    const observed = [{ versionId: first.versionId, sha: first.sha }];
    let previous = first;
    for (let attempt = 0; attempt < attempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const current = await read();
      observed.push({ versionId: current.versionId, sha: current.sha });
      if (
        converged(current) &&
        previous.versionId === current.versionId &&
        previous.sha === current.sha
      ) {
        const sender = confirm(current);
        return { versionId: current.versionId, sha: current.sha, sender };
      }
      previous = current;
    }
    const stableSha = observed.every((item) => item.sha === observed[0]?.sha);
    if (
      expectedSha !== undefined &&
      stableSha &&
      observed[0]?.sha !== expectedSha
    )
      diagnostics.start("version-tag", "divergência de configuração");
    else
      diagnostics.start("version-convergence", "divergência de configuração");
    console.info(
      JSON.stringify({
        operacao: "versao-dev-divergente",
        versoes: [...new Set(observed.map((item) => item.versionId))],
      }),
    );
    throw new Error("Versão ativa não convergiu entre deployments e versions");
  }
  // Falha antes do upload se o alvo ou a continuidade não puderem ser comprovados.
  const previous = await activeVersion("previous");
  console.info(
    JSON.stringify({ operacao: "versao-dev-anterior", ...previous }),
  );
  diagnostics.phase = "bundle";
  diagnostics.start("bundle-read", "falha de operação local");
  const baseConfig = await readFile("wrangler.jsonc", "utf8");
  diagnostics.start("bundle-parse", "resposta inesperada");
  const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", baseConfig);
  assert.ok(!parsed.error);
  const parsedConfig: unknown = parsed.config;
  const config = diagnostics.verify("bundle-config", () =>
    deploymentConfig(parsedConfig, settings.hyperdrive),
  );
  config.vars.LEVI_EMAIL_FROM = env.LEVI_EMAIL_FROM;
  // Secrets só podem existir em memória volátil no runner Linux, nunca no checkout.
  diagnostics.start("secrets-memory", "falha de operação local");
  const memory = await statfs("/dev/shm");
  assert.equal(memory.type, 0x01021994); // TMPFS_MAGIC
  diagnostics.start("bundle-directory", "falha de operação local");
  directory = await mkdtemp("/dev/shm/levi-dev-deploy-");
  const configPath = join(directory, "wrangler.json");
  diagnostics.start("bundle-files", "falha de operação local");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await currentMain();
  diagnostics.phase = "publish";
  const currentCI = await requireSuccessfulCI(env, fetch, diagnostics);
  diagnostics.start("ci-unchanged");
  assert.deepEqual(currentCI, ci);
  const beforeUpload = await activeVersion("previous");
  diagnostics.start("version-unchanged");
  assert.deepEqual(beforeUpload, previous);
  diagnostics.start("secrets-file", "falha de operação local");
  const secretsPath = join(directory, "secrets.json");
  // Lista explícita: nunca incluir AUTH_SECRET legado ou credenciais do executor.
  await writeFile(
    secretsPath,
    JSON.stringify({
      RESEND_API_KEY: env.RESEND_API_KEY,
      LEVI_AUTH_SECRET: env.LEVI_AUTH_SECRET,
      LEVI_ADMIN_EMAIL: administrativeEmail(env.LEVI_ADMIN_EMAIL) ?? "",
    }),
    { mode: 0o600, flag: "wx" },
  );
  // Detecta mudanças durante o preflight; não substitui contenção entre repositórios.
  // A saída bruta pode conter configuração privada: nunca é impressa ou anexada.
  diagnostics.start("wrangler", "falha de operação local");
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "deploy",
      "--config",
      configPath,
      "--secrets-file",
      secretsPath,
      "--tag",
      settings.sha,
      "--strict",
    ],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: {
        PATH: env.PATH,
        HOME: env.HOME,
        CI: "true",
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_WRITE_LOGS: "false",
        WRANGLER_LOG_SANITIZE: "true",
        CLOUDFLARE_ACCOUNT_ID: settings.account,
        CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
      },
    },
  );
  if (result.status !== 0 && result.error) throw result.error;
  assert.equal(result.status, 0);
  diagnostics.phase = "published";
  await protections();
  const published = await activeVersion("published");
  diagnostics.inspect("version-tag");
  assert.equal(published.sha, settings.sha);
  // A evidência do binding é da versão com tráfego, não apenas da config enviada.
  console.info(
    JSON.stringify({
      operacao: "versao-dev-confirmada",
      sha: settings.sha,
      versionId: published.versionId,
      trafego: 100,
      bindingHyperdrive: "conferido",
      tlsOrigem: "verify-full-configurado",
    }),
  );
  for (const [path, requestCheck, responseCheck, expectedStatus] of [
    ["/", "home-read", "home-response", 200],
    ["/admin", "admin-read", "admin-response", 404],
    ["/api/admin/session", "admin-api-read", "admin-api-response", 404],
    ["/api/onboarding", "onboarding-read", "onboarding-response", 200],
    ["/api/organizations", "organizations-read", "organizations-response", 401],
    ["/api/churches", "churches-read", "churches-response", 401],
    ["/api/members", "members-read", "members-response", 401],
  ] as const) {
    const response = await diagnostics.request(
      requestCheck,
      () =>
        fetch(`${deployOrigin}${path}`, {
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        }),
      expectedStatus,
    );
    diagnostics.inspect(
      responseCheck,
      response.status === expectedStatus ? "resposta inesperada" : "falha HTTP",
    );
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.ok(response.headers.get("content-security-policy"));
    if (path === "/admin" || path === "/api/admin/session")
      assert.ok(response.headers.get("cache-control")?.includes("no-store"));
    if (path === "/") {
      diagnostics.httpStatus(response, 200);
      assert.ok(response.headers.get("content-type")?.includes("text/html"));
      await response.body?.cancel();
    } else if (path === "/api/onboarding") {
      diagnostics.httpStatus(response, 200);
      diagnostics.start(
        "onboarding-body",
        "resposta inesperada",
        response.status,
      );
      assert.deepEqual(await response.json(), { etapa: "email" });
    } else {
      diagnostics.httpStatus(response, expectedStatus);
      await response.body?.cancel();
    }
  }
  console.info(
    `Versão ${settings.sha} publicada; SHA ativo, acesso público e bloqueio de dados privados conferidos. E-mails, fluxo autenticado e CPU Free ainda exigem validação remota.`,
  );
  console.info(
    "Smokes DEV aprovados. O middleware de abuso executa SQL técnico pelo binding; conectividade inferida desse fluxo, sem consulta de identidade SQL ou homologação funcional de membros.",
  );
} catch (error) {
  diagnostics.report(error, console.error);
  process.exitCode = 1;
} finally {
  if (directory) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      diagnostics.phase = "cleanup";
      diagnostics.start("cleanup", "falha de operação local");
      diagnostics.report(error, console.error);
      process.exitCode = 1;
    }
  }
}
