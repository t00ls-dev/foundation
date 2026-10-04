import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

// This test never publishes. Foundation is installed exclusively from tarballs,
// outside the workspace, with no paths/baseUrl or workspace dependency resolution.
const root = resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "foundation-distribution-"));
const artifacts = join(temporary, "artifacts");
mkdirSync(artifacts);
const names = [
  "access",
  "audit",
  "auth",
  "config",
  "db",
  "email",
  "observability",
  "security",
  "tenant",
];
const expectedEntrypoints = [
  "@t00ls-dev/access",
  "@t00ls-dev/audit",
  "@t00ls-dev/audit/d1",
  "@t00ls-dev/audit/postgres",
  "@t00ls-dev/auth",
  "@t00ls-dev/config",
  "@t00ls-dev/db",
  "@t00ls-dev/db/d1",
  "@t00ls-dev/db/postgres",
  "@t00ls-dev/db/postgres-migrations",
  "@t00ls-dev/email",
  "@t00ls-dev/observability",
  "@t00ls-dev/security",
  "@t00ls-dev/tenant",
  "@t00ls-dev/tenant/d1",
  "@t00ls-dev/tenant/postgres",
  "@t00ls-dev/tenant/schema/d1",
  "@t00ls-dev/tenant/schema/postgres",
];
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const run = (command, args, cwd = root) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const save = (directory, name, value) =>
  writeFileSync(join(directory, name), value);

function diagnostics(directory, file, profile = "node", emit = false) {
  const result = JSON.parse(
    run(process.execPath, [
      join(root, "tests/distribution-typecheck.mjs"),
      directory,
      file,
      profile,
      ...(emit ? ["emit"] : []),
    ]),
  );
  assert.equal(result.compilerVersion, ts.version);
  for (const file of result.sourceFiles)
    assert(
      realpathSync(file).startsWith(directory + "/"),
      `Type resolution escaped consumer: ${file}`,
    );
  return result;
}

function fingerprint(diagnostic) {
  const file = realpathSync(diagnostic.file);
  // Diagnostic text can order/truncate union members differently depending on
  // import order. Require the same upstream file, exact position and error code.
  return `${file}:${diagnostic.start}:${diagnostic.length}:${diagnostic.code}`;
}

function multiset(errors) {
  const counts = new Map();
  for (const diagnostic of errors) {
    const key = fingerprint(diagnostic);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function category(error) {
  if (error.file?.includes("/drizzle-orm/")) return "Drizzle";
  if (error.file?.includes("/@better-auth/core/")) return "BetterAuth";
  if (error.file?.includes("/@cloudflare/workers-types/")) return "Workers";
  if (error.file?.includes("/@types/node/")) return "Node";
  if (error.file?.includes("/typescript/lib/")) return "TypeScriptLibs";
  return "Unexpected";
}

function countsByCategory(result) {
  const counts = {};
  for (const error of result.errors) {
    const group = category(error);
    counts[group] = (counts[group] ?? 0) + 1;
  }
  return counts;
}

function assertIntrinsicOnly(result, allowMissingD1 = false) {
  for (const error of result.errors) {
    assert(error.file, "Unresolved compiler configuration");
    assert(
      ["Drizzle", "BetterAuth"].includes(category(error)),
      `Not an intrinsic dependency diagnostic: ${JSON.stringify(error)}`,
    );
    if (!allowMissingD1)
      assert(
        !/Cannot find name 'D1/.test(error.message),
        "Missing D1 globals in supported profile",
      );
  }
}

function assertNoAdditionalDiagnostics(result, control) {
  assertIntrinsicOnly(result);
  const baseline = multiset(control.errors);
  for (const error of result.errors) {
    const key = fingerprint(error);
    assert(
      (baseline.get(key) ?? 0) > 0,
      `New diagnostic in supported profile: ${JSON.stringify(error)}`,
    );
    baseline.set(key, baseline.get(key) - 1);
  }
}

const imports = (entries) =>
  entries
    .map(
      (entry, index) =>
        `import * as p${index} from ${JSON.stringify(entry)};\nexport { p${index} };`,
    )
    .join("\n");
const envProbe = "\nexport const processEnv = process.env;\n";

try {
  const pnpm = process.env.npm_execpath;
  assert(pnpm, "Run this test using pnpm test:distribution");
  run(process.execPath, [
    pnpm,
    // Pack only the existing distribution inventory. Private workspaces such
    // as UI consume sources and must not become release artifacts.
    ...names.flatMap((name) => ["--filter", `@t00ls-dev/${name}`]),
    "-r",
    "pack",
    "--pack-destination",
    artifacts,
  ]);
  assert.equal(readdirSync(artifacts).length, 9);
  const manifests = names.map((name) => {
    const source = json(join(root, "packages", name, "package.json"));
    const tarball = join(artifacts, `t00ls-dev-${name}-${source.version}.tgz`);
    const entries = run("tar", ["-tvzf", tarball]);
    assert(
      !entries.split("\n").some((line) => /^[lh]/.test(line)),
      "No symlinks/hardlinks in tarballs",
    );
    const files = new Set(
      run("tar", ["-tzf", tarball])
        .trim()
        .split("\n")
        .map((file) => file.replace(/^package\//, "")),
    );
    const packed = JSON.parse(
      run("tar", ["-xOzf", tarball, "package/package.json"]),
    );
    assert.equal(packed.name, source.name);
    assert.equal(packed.version, source.version);
    assert.equal(packed.license, "UNLICENSED");
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      assert(!packed[field]?.["@t00ls-dev/typescript-config"]);
      for (const range of Object.values(packed[field] ?? {}))
        assert(
          !/^(workspace:|file:|link:)/.test(range),
          `${name}: invalid ${field}`,
        );
    }
    for (const entry of Object.values(packed.exports)) {
      assert(
        files.has(entry.types.slice(2)) && files.has(entry.default.slice(2)),
      );
    }
    for (const file of files) {
      assert(
        /^(dist\/.*\.(js|d\.ts)|README\.md|package\.json)$/.test(file),
        `${name}: unexpected file ${file}`,
      );
      if (file.endsWith(".d.ts")) {
        const declaration = run("tar", ["-xOzf", tarball, `package/${file}`]);
        assert(
          !declaration.includes("sourceMappingURL") &&
            !declaration.includes(root),
        );
      }
    }
    console.log(
      `${source.name}@${source.version}: ${files.size} files; metadata/exports/maps OK`,
    );
    return { source, tarball };
  });

  const entrypoints = manifests.flatMap(({ source }) =>
    Object.keys(source.exports).map(
      (subpath) => source.name + (subpath === "." ? "" : subpath.slice(1)),
    ),
  );
  assert.deepEqual(entrypoints.toSorted(), expectedEntrypoints.toSorted());
  for (let attempt = 1; attempt <= 2; attempt++) {
    const consumer = join(temporary, `consumer-${attempt}`);
    mkdirSync(consumer);
    // Pin the tested dependency versions, not patched copies. No third-party
    // declarations are changed; their diagnostics are compared to direct imports.
    const dependencies = Object.fromEntries(
      manifests.map(({ source, tarball }) => [source.name, tarball]),
    );
    save(
      consumer,
      "package.json",
      JSON.stringify({
        private: true,
        type: "module",
        dependencies,
        devDependencies: { "typescript": ts.version, "@types/node": "22.20.4" },
        overrides: {
          "drizzle-orm": "0.45.2",
          "better-auth": "1.7.7",
          "@cloudflare/workers-types": "5.20260922.1",
        },
      }),
    );
    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
      ],
      consumer,
    );
    const require = createRequire(join(consumer, "package.json"));
    assert.equal(
      json(join(consumer, "node_modules/better-auth/package.json")).version,
      "1.7.7",
    );
    for (const entry of entrypoints)
      assert(
        realpathSync(require.resolve(entry)).startsWith(consumer + "/"),
        `Workspace leak: ${entry}`,
      );
    assert.throws(() => require.resolve("@t00ls-dev/typescript-config"));

    // Pure controls have no Foundation imports and no Cloudflare injection.
    const externalNonD1 = [
      "drizzle-orm/postgres-js",
      "drizzle-orm/sqlite-core",
      "drizzle-orm/pg-core",
      "better-auth",
    ];
    save(
      consumer,
      "pure-upstream.ts",
      imports(["drizzle-orm/d1", ...externalNonD1]) + envProbe,
    );
    const pure = diagnostics(consumer, "pure-upstream.ts");
    assertIntrinsicOnly(pure, true);
    assert.equal(pure.processEnvType, "ProcessEnv");
    assert(
      !pure.sourceFiles.some((file) =>
        file.includes("/@cloudflare/workers-types/"),
      ),
      "Pure upstream control loaded Workers Types",
    );

    save(consumer, "non-d1-upstream.ts", imports(externalNonD1) + envProbe);
    const nonD1Control = diagnostics(consumer, "non-d1-upstream.ts");
    assertIntrinsicOnly(nonD1Control);
    const nonD1Entrypoints = expectedEntrypoints.filter(
      (entry) =>
        ![
          "@t00ls-dev/audit/d1",
          "@t00ls-dev/db/d1",
          "@t00ls-dev/tenant/d1",
        ].includes(entry),
    );
    save(
      consumer,
      "non-d1.ts",
      imports(nonD1Entrypoints) +
        envProbe +
        `
import type { FoundationAuth, FoundationSession } from "@t00ls-dev/auth";
export async function resolveAuth(auth: FoundationAuth, headers: Headers) {
  const result = await auth.resolveSession(headers);
  const data: FoundationSession | null = result.data;
  const responseHeaders: Headers = result.headers;
  const userId: string | undefined = data?.user.id;
  // @ts-expect-error Better Auth internals are not part of FoundationAuth.
  auth.api;
  return { userId, responseHeaders };
}
`,
    );
    const nonD1 = diagnostics(consumer, "non-d1.ts");
    assertNoAdditionalDiagnostics(nonD1, nonD1Control);
    assert.equal(nonD1.processEnvType, "ProcessEnv");
    assert(
      !nonD1.sourceFiles.some((file) =>
        file.includes("/@cloudflare/workers-types/index.d.ts"),
      ),
      "Non-D1 entries loaded Cloudflare globals",
    );

    // audit/tenant use importable official types, not a global Worker environment.
    const adapters =
      'import type { D1Database } from "@cloudflare/workers-types";\nimport { createD1AuditStore } from "@t00ls-dev/audit/d1";\nimport { createD1TenantRepository } from "@t00ls-dev/tenant/d1";\nexport function calls(db: D1Database) { return [createD1AuditStore(db), createD1TenantRepository(db)]; }\n// @ts-expect-error A missing D1 binding is not accepted.\ncreateD1AuditStore({});\n// @ts-expect-error A missing D1 binding is not accepted.\ncreateD1TenantRepository({});\n';
    save(consumer, "adapters.ts", adapters + envProbe);
    const adapterResult = diagnostics(consumer, "adapters.ts");
    assert.deepEqual(adapterResult.errors, []);
    assert.equal(adapterResult.processEnvType, "ProcessEnv");

    // db/d1 is a Cloudflare Workers/D1 integration, not a Node+DOM integration.
    // The control's Workers runtime is configured intentionally and separately
    // from the pure control; never call its mixed-profile conflicts intrinsic.
    save(consumer, "workers-upstream.ts", imports(["drizzle-orm/d1"]));
    const workerControl = diagnostics(
      consumer,
      "workers-upstream.ts",
      "workers-runtime",
    );
    assertIntrinsicOnly(workerControl);
    save(
      consumer,
      "workers.ts",
      'import { createD1Database } from "@t00ls-dev/db/d1";\nimport type { D1Database } from "@cloudflare/workers-types";\nexport function calls(db: D1Database) { const orm = createD1Database(db); const same: D1Database = orm.$client; return { orm, same }; }\n// @ts-expect-error A missing D1 binding is not accepted.\ncreateD1Database({});\n',
    );
    const workers = diagnostics(consumer, "workers.ts", "workers");
    assertNoAdditionalDiagnostics(workers, workerControl);
    assert(
      !workers.sourceFiles.some(
        (file) => file.includes("/lib.dom.") || file.includes("/@types/node/"),
      ),
      "Supported Workers profile loaded Node/DOM globals",
    );

    // Characterize the unsupported mixed profile causally: adding db/d1 to
    // the unchanged non-D1 consumer must expose known global conflicts. They
    // are NOT accepted as upstream-only errors in either supported profile.
    save(consumer, "mixed.ts", imports(expectedEntrypoints) + envProbe);
    const mixed = diagnostics(consumer, "mixed.ts");
    const mixedCounts = countsByCategory(mixed);
    assert(
      !mixedCounts.Unexpected,
      "Unexpected/Foundation error even in mixed profile",
    );
    assert.equal(
      mixed.processEnvType,
      "any",
      "Revisit documented mixed-profile limitation",
    );
    assert(
      mixedCounts.Workers > 0 &&
        mixedCounts.Node > 0 &&
        mixedCounts.TypeScriptLibs > 0,
      "Mixed-profile characterization changed; review it",
    );
    const mixedGlobals = mixed.errors.filter((error) =>
      ["Workers", "Node", "TypeScriptLibs"].includes(category(error)),
    );
    assert(
      !nonD1.errors.some((error) =>
        ["Workers", "Node", "TypeScriptLibs"].includes(category(error)),
      ),
      "Globals already polluted the non-D1 profile",
    );

    const report = {
      pure,
      nonD1Control,
      nonD1,
      adapterResult,
      workerControl,
      workers,
      mixed,
    };
    save(consumer, "diagnostics.json", JSON.stringify(report, null, 2));
    console.log(
      `Clean installation ${attempt}: pure dependencies ${JSON.stringify(countsByCategory(pure))}; non-D1 ${JSON.stringify(countsByCategory(nonD1))}; audit/tenant D1 zero errors`,
    );
    console.log(
      `Workers contract: ${JSON.stringify(countsByCategory(workers))}; zero additional Foundation diagnostics versus native Workers Drizzle; skipLibCheck:false`,
    );
    console.log(
      `UNSUPPORTED mixed Node/DOM/Workers: ${mixedGlobals.length} integration-induced global conflicts; process.env becomes any; ${JSON.stringify(mixedCounts)} (NOT upstream-only)`,
    );

    // Emit/run all imports as a separate runtime check, not a claim that the
    // unsupported mixed-profile typecheck is clean.
    save(consumer, "all.ts", imports(expectedEntrypoints));
    const emitted = diagnostics(consumer, "all.ts", "node", true);
    assert.deepEqual(emitted.errors, mixed.errors);
    run(process.execPath, [join(consumer, "dist", "all.js")], consumer);
    save(
      consumer,
      "runtime.mjs",
      'import assert from "node:assert/strict";\nimport { createD1AuditStore } from "@t00ls-dev/audit/d1";\nimport { createD1Database } from "@t00ls-dev/db/d1";\nimport { createD1TenantRepository } from "@t00ls-dev/tenant/d1";\nconst db = { prepare: () => ({ bind() { return this; }, run: async () => ({ success: true }), first: async () => null }) };\nassert.equal(createD1Database(db).$client, db);\nassert.equal(await createD1TenantRepository(db).findMembership("u", "t"), null);\nassert.equal(typeof createD1AuditStore(db).append, "function");\n',
    );
    run(process.execPath, [join(consumer, "runtime.mjs")], consumer);
    console.log(
      `Clean installation ${attempt}: build, all ${entrypoints.length} public imports and D1 runtime PASS`,
    );
    // Consumers are ephemeral; retain reports/artifacts without accumulating
    // dependency trees between runs or masking the second clean installation.
    rmSync(join(consumer, "node_modules"), { recursive: true, force: true });
  }
  console.log(`Artifacts and diagnostic evidence: ${temporary}`);
} catch (error) {
  console.error(`Distribution test failed; evidence retained at ${temporary}`);
  if (error.stderr) console.error(error.stderr.toString());
  throw error;
}
