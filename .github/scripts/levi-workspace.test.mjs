import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { parse } from "yaml";
import { workspaceManifests } from "./workspace.mjs";

const root = resolve(import.meta.dirname, "../..");
const application = join(root, "apps/levi");
const source = "b2c892e27e3a8988f0be554692ffea43d35fcd61";
const shared = ["access", "audit", "auth", "db", "email", "security", "tenant"];
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const files = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });

test("Levi privado resolve os pacotes locais com todos os workspaces privados", () => {
  const manifests = workspaceManifests(root);
  assert.deepEqual(
    manifests
      .filter(({ pkg }) => !pkg.private)
      .map(({ pkg }) => pkg.name)
      .sort(),
    [],
  );
  const { pkg } = manifests.find(({ path }) => path === "apps/levi");
  assert.equal(pkg.name, "levi");
  assert.equal(pkg.version, "0.1.0");
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.packageManager, undefined);
  assert.equal(pkg.overrides, undefined);
  assert.equal(existsSync(join(application, "package-lock.json")), false);
  assert.deepEqual(
    Object.keys(pkg.dependencies)
      .filter((name) => name.startsWith("@t00ls-dev/"))
      .sort(),
    [...shared, "ui"].map((name) => `@t00ls-dev/${name}`).sort(),
  );
  for (const name of [...shared, "ui"]) {
    assert.equal(pkg.dependencies[`@t00ls-dev/${name}`], "workspace:*");
    assert.equal(
      realpathSync(join(application, "node_modules/@t00ls-dev", name)),
      realpathSync(join(root, "packages", name)),
    );
  }
  assert.equal(
    json(join(application, "node_modules/better-auth/package.json")).version,
    json(join(root, "packages/auth/node_modules/better-auth/package.json"))
      .version,
  );
});

test("build do Levi depende dos exports compilados dos sete pacotes", () => {
  const graph = JSON.parse(
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules/turbo/bin/turbo"),
        "run",
        "build",
        "--filter=levi",
        "--dry=json",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          TURBO_TELEMETRY_DISABLED: "1",
          TURBO_NO_UPDATE_NOTIFIER: "1",
        },
      },
    ),
  );
  const task = graph.tasks.find(({ taskId }) => taskId === "levi#build");
  for (const name of shared)
    assert(task.dependencies.includes(`@t00ls-dev/${name}#build`));
  assert.equal(
    graph.tasks.some(
      ({ package: name }) => name === "@t00ls-dev/example-links",
    ),
    false,
  );
});

test("subtree preserva os 35 commits e a árvore original sem squash", () => {
  const incorporation = "dfd1192b7b5e509878f65bec09228cb269d9cd82";
  assert.equal(git("rev-list", "--count", source), "35");
  git("merge-base", "--is-ancestor", incorporation, "HEAD");
  assert.equal(
    git("rev-parse", `${incorporation}^1`),
    "3f892412a3f223df7ea394720b3bfe5b149c01c6",
  );
  assert.equal(git("rev-parse", `${incorporation}^2`), source);
  assert.equal(
    git("rev-parse", `${incorporation}:apps/levi`),
    git("rev-parse", `${source}^{tree}`),
  );
});

test("imports de runtime do Levi ficam na aplicação ou nos exports públicos", () => {
  for (const file of [
    ...files(join(application, "src")),
    ...files(join(application, "web")),
  ]) {
    if (!/\.tsx?$/.test(file)) continue;
    const tree = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const inspect = (specifier) => {
      if (specifier.startsWith(".")) {
        assert(
          resolve(dirname(file), specifier).startsWith(application + sep),
          `Import fora do Levi: ${file}`,
        );
      } else if (specifier.startsWith("@t00ls-dev/")) {
        const [, name, ...parts] = specifier.split("/");
        assert([...shared, "ui"].includes(name));
        const manifest = json(join(root, "packages", name, "package.json"));
        assert(
          Object.hasOwn(
            manifest.exports,
            name === "ui" && parts[0] === "components" && parts.length === 2
              ? "./components/*"
              : parts.length
                ? `./${parts.join("/")}`
                : ".",
          ),
        );
      }
      assert.equal(specifier.includes("examples/links"), false);
    };
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        inspect(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        assert.equal(node.arguments.length, 1);
        assert(
          ts.isStringLiteral(node.arguments[0]),
          "Import dinâmico precisa de fronteira verificável",
        );
        inspect(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
});

test("CI do Levi não recebe Environment, secrets ou entrada operacional", () => {
  const ci = parse(
    readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  for (const name of ["levi-tests", "levi-e2e"]) {
    const job = ci.jobs[name];
    assert.equal(job.environment, undefined);
    assert.equal(JSON.stringify(job).includes("secrets."), false);
    assert.equal(JSON.stringify(job).includes("deploy:dev"), false);
    assert.equal(JSON.stringify(job).includes("db:migrate:dev"), false);
    assert(ci.jobs.checks.needs.includes(name));
  }
  const deploy = parse(
    readFileSync(join(root, ".github/workflows/deploy-levi-dev.yml"), "utf8"),
  );
  assert.deepEqual(Object.keys(deploy.on), ["workflow_dispatch"]);
  assert.equal(
    existsSync(join(root, ".github/workflows/levi-deploy-dev.yml")),
    false,
  );
});

test("publicador Levi manual permanece isolado e bloqueia readiness antes de credenciais", () => {
  const workflow = parse(
    readFileSync(join(root, ".github/workflows/deploy-levi-dev.yml"), "utf8"),
  );
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch, null);
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  assert.deepEqual(workflow.concurrency, {
    "group": "levi-dev",
    "cancel-in-progress": false,
  });
  assert.deepEqual(Object.keys(workflow.jobs), ["validate", "deploy"]);
  const { validate, deploy } = workflow.jobs;
  assert.equal(validate.environment, undefined);
  assert.equal(deploy.environment, "levi-dev");
  assert.equal(deploy.needs, "validate");
  const sha = "a".repeat(40);
  const trusted = {
    github: {
      repository: "t00ls-dev/foundation",
      event_name: "workflow_dispatch",
      ref: "refs/heads/master",
      sha,
    },
    inputs: { execution_sha: sha },
    needs: { validate: { result: "success", outputs: { sha } } },
  };
  for (const job of [validate, deploy]) {
    const allows = (context) => runInNewContext(job.if, context);
    assert.equal(allows(trusted), true);
    for (const context of [
      ...["workflow_run", "pull_request", "push"].map((event_name) => ({
        ...trusted,
        github: { ...trusted.github, event_name },
      })),
      ...["unrelated/levi", "fork/foundation"].map((repository) => ({
        ...trusted,
        github: { ...trusted.github, repository },
      })),
      ...["refs/heads/main", "refs/heads/feature", "refs/pull/150/merge"].map(
        (ref) => ({ ...trusted, github: { ...trusted.github, ref } }),
      ),
    ])
      assert.equal(allows(context), false);
  }
  for (const result of ["failure", "skipped", "cancelled", "pending"])
    assert.equal(
      runInNewContext(deploy.if, {
        ...trusted,
        needs: { validate: { result, outputs: { sha } } },
      }),
      false,
    );
  assert.equal(
    runInNewContext(deploy.if, {
      ...trusted,
      needs: {
        validate: { result: "success", outputs: { sha: "b".repeat(40) } },
      },
    }),
    false,
  );
  assert.equal(validate.steps[0].with.ref, "${{ github.sha }}");
  assert.equal(validate.steps[0].with["persist-credentials"], false);
  assert.equal(
    validate.steps[1].run,
    "node .github/scripts/ci-evidence.mjs deploy",
  );
  assert.equal(JSON.stringify(validate).includes("secrets."), false);
  const readiness = deploy.steps[0];
  assert.equal(readiness.id, "readiness");
  assert.deepEqual(readiness.env, {
    DEPLOY_READY: "${{ vars.LEVI_DEPLOY_READY }}",
  });
  assert.equal(readiness.if, undefined);
  assert.equal(readiness["continue-on-error"], undefined);
  for (const value of [
    undefined,
    "",
    "false",
    "TRUE",
    "1",
    " true ",
    "invalid",
    "true",
  ]) {
    const result = spawnSync(
      "bash",
      ["--noprofile", "--norc", "-eo", "pipefail", "-c", readiness.run],
      {
        encoding: "utf8",
        env: value === undefined ? {} : { DEPLOY_READY: value },
      },
    );
    assert.equal(result.status, value === "true" ? 0 : 1);
    if (value !== "true")
      assert.match(result.stdout, /::error::Deploy Levi DEV bloqueado/);
  }
  assert.equal(deploy.steps[1].with.ref, "${{ needs.validate.outputs.sha }}");
  assert.equal(deploy.steps[1].with["persist-credentials"], false);
  assert.equal(
    deploy.steps.find((step) => step.id === "install").uses,
    "./.github/actions/setup",
  );
  const setup = parse(
    readFileSync(join(root, ".github/actions/setup/action.yml"), "utf8"),
  );
  assert(
    setup.runs.steps.some(
      (step) => step.run === "pnpm install --frozen-lockfile",
    ),
  );
  assert.equal(
    deploy.steps.find((step) => step.id === "build").run,
    "pnpm exec turbo run build --filter=levi",
  );
  const publish = deploy.steps.find((step) => step.id === "publish");
  assert.equal(publish["working-directory"], "apps/levi");
  assert.equal(publish.run, "pnpm deploy:dev");
  assert.equal(
    publish.env.LEVI_DEPLOY_SHA,
    "${{ needs.validate.outputs.sha }}",
  );
  assert.equal(publish.env.LEVI_DEV_READY, "${{ vars.LEVI_DEPLOY_READY }}");
  assert.equal("LEVI_MEMBERS_DEV_ORGANIZATIONS" in publish.env, false);
  assert.deepEqual(
    Object.values(publish.env)
      .filter((value) => value.includes("secrets."))
      .sort(),
    [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "RESEND_API_KEY",
      "LEVI_AUTH_SECRET",
      "LEVI_ADMIN_EMAIL",
    ]
      .map((name) => "${{ secrets." + name + " }}")
      .sort(),
  );
  for (const [internal, configured] of Object.entries({
    LEVI_HYPERDRIVE_ID: "vars.LEVI_HYPERDRIVE_ID",
    LEVI_DEV_DATABASE_HOST: "vars.LEVI_DATABASE_HOST",
    LEVI_DEV_DATABASE_NAME: "vars.LEVI_DATABASE_NAME",
    LEVI_EMAIL_FROM: "vars.LEVI_EMAIL_FROM",
  }))
    assert.equal(publish.env[internal], "${{ " + configured + " }}");
  assert.equal(publish.env.LEVI_AUTH_SECRET, "${{ secrets.LEVI_AUTH_SECRET }}");
  assert.equal(publish.env.AUTH_SECRET, undefined);
  assert.equal(publish.env.RESEND_API_KEY, "${{ secrets.RESEND_API_KEY }}");
  assert.equal(publish.if, undefined);
  assert.equal(publish["continue-on-error"], undefined);
  for (const step of deploy.steps.slice(1, deploy.steps.indexOf(publish))) {
    assert.equal(step.if, undefined);
    assert.equal(step["continue-on-error"], undefined);
  }
  for (const step of deploy.steps.filter((step) => step !== publish))
    assert.equal(JSON.stringify(step).includes("secrets."), false);
  const operations = JSON.stringify(workflow);
  for (const forbidden of [
    "workflow_run",
    "workflow_call",
    "LEVI_DEV_DEPLOY_ENABLED",
    "CLOUDFLARE_READ_TOKEN",
    "download-artifact",
    "npm run",
    "db:migrate",
    "migrate-dev",
    "migrations.mjs",
    "examples/links",
    "release.yml",
    "D1_MIGRATION_TOKEN",
    "DATABASE_URL",
  ])
    assert.equal(operations.includes(forbidden), false, forbidden);
  assert.equal(deploy.steps.filter((step) => step.id === "publish").length, 1);
});

test("publicador lê apenas variables canônicas e não aproveita gate ou aliases legados", () => {
  const workflow = parse(
    readFileSync(join(root, ".github/workflows/deploy-levi-dev.yml"), "utf8"),
  );
  const deploy = workflow.jobs.deploy;
  const publish = deploy.steps.find((step) => step.id === "publish");
  const mappings = {
    LEVI_EMAIL_FROM: "LEVI_EMAIL_FROM",
    LEVI_HYPERDRIVE_ID: "LEVI_HYPERDRIVE_ID",
    LEVI_DEV_DATABASE_HOST: "LEVI_DATABASE_HOST",
    LEVI_DEV_DATABASE_NAME: "LEVI_DATABASE_NAME",
    LEVI_DEV_READY: "LEVI_DEPLOY_READY",
  };
  const variables = {
    LEVI_EMAIL_FROM: "Levi <hi@levi.t00ls.dev>",
    LEVI_HYPERDRIVE_ID: "c".repeat(32),
    LEVI_DATABASE_HOST: "ep-synthetic.us-east-2.aws.neon.tech",
    LEVI_DATABASE_NAME: "levi_dev",
    LEVI_DEPLOY_READY: "true",
    EMAIL_FROM: "legacy-not-consumed",
    HYPERDRIVE_ID: "legacy-not-consumed",
    DATABASE_HOST: "legacy-not-consumed",
    DATABASE_NAME: "legacy-not-consumed",
    DEPLOY_READY: "true",
  };
  const evaluate = (expression, vars) =>
    runInNewContext(expression.slice(3, -2), { vars }) ?? "";
  for (const [internal, canonical] of Object.entries(mappings)) {
    assert.equal(
      evaluate(publish.env[internal], variables),
      variables[canonical],
    );
    const missing = { ...variables, [canonical]: undefined };
    assert.equal(evaluate(publish.env[internal], missing), "");
  }
  const readiness = deploy.steps[0];
  for (const canonical of [undefined, "false", "true"]) {
    const resolved = evaluate(readiness.env.DEPLOY_READY, {
      ...variables,
      LEVI_DEPLOY_READY: canonical,
    });
    const result = spawnSync(
      "bash",
      ["--noprofile", "--norc", "-eo", "pipefail", "-c", readiness.run],
      { encoding: "utf8", env: { DEPLOY_READY: resolved } },
    );
    assert.equal(result.status, canonical === "true" ? 0 : 1);
    if (canonical !== "true")
      assert.ok(result.stdout.includes("LEVI_DEPLOY_READY"));
  }
});
