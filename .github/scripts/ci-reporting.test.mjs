import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { testSummary, writeSummary } from "./test-summary.mjs";

const root = resolve(import.meta.dirname, "../..");
const reporter = (name) => join(root, ".github/scripts", name);
const require = createRequire(join(root, "apps/levi/package.json"));
const playwright = dirname(require.resolve("@playwright/test/package.json"));
const fixture = (run) => {
  const directory = mkdtempSync(join(tmpdir(), "foundation-ci-report-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
function execute(cli, args, directory, summary) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_TEST_SUITE: "Fixture",
      GITHUB_STEP_SUMMARY: summary,
      FORCE_COLOR: "0",
    },
  });
  assert.ifError(result.error);
  return { ...result, output: result.stdout + result.stderr };
}
const read = (path) => readFileSync(path, "utf8");
const assertCounts = (summary, counts) => {
  for (const [name, count] of Object.entries(counts))
    assert(summary.includes(`| ${name} | ${count} |`), summary);
  assert.match(summary, /Duração: \*\*\d+\.\d s\*\*/);
};

test("summary escapes test names and limits failure details without changing counts", () => {
  const summary = testSummary(
    "suite<script>|\n",
    { Passed: 0, Failed: 6, Skipped: 0, Flaky: 0 },
    1250,
    {
      failures: Array.from({ length: 6 }, () => "<img> [link](x) |\n"),
    },
  );
  assert.match(summary, /❌ Há testes com falha/);
  assert.match(summary, /&lt;script&gt;/);
  assert(!summary.includes("<img>"));
  assert(summary.includes("Mais 1 falhas nos logs"));
  assertCounts(summary, { Passed: 0, Failed: 6, Skipped: 0, Flaky: 0 });
});

test("summary write failures are informational", () => {
  const previous = process.env.GITHUB_STEP_SUMMARY;
  try {
    process.env.GITHUB_STEP_SUMMARY = join(
      tmpdir(),
      "nonexistent-parent",
      "summary.md",
    );
    assert.doesNotThrow(() => writeSummary("fixture"));
  } finally {
    if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = previous;
  }
});

test("real Vitest reporter preserves failure diagnostics, retry and skipped/todo counts", () =>
  fixture((dir) => {
    writeFileSync(
      join(dir, "vitest.config.mjs"),
      'export default { test: { include: ["fixture.test.mjs"] } };',
    );
    writeFileSync(
      join(dir, "fixture.test.mjs"),
      `
import { test, expect } from ${JSON.stringify(pathToFileURL(join(root, "node_modules/vitest/dist/index.js")).href)};
test("passed", () => expect(1).toBe(1));
test.skip("skipped", () => {});
test.todo("todo");
let attempts = 0;
test("flaky", { retry: 1 }, () => expect(++attempts).toBe(2));
test("diagnostic-marker", () => expect(1).toBe(2));
`,
    );
    const cli = join(root, "node_modules/vitest/vitest.mjs");
    const baseline = execute(
      cli,
      ["run", "--reporter=default", "--reporter=github-actions"],
      dir,
      join(dir, "baseline.md"),
    );
    const current = execute(
      cli,
      [
        "run",
        "--reporter=default",
        `--reporter=${reporter("vitest-summary.mjs")}`,
      ],
      dir,
      join(dir, "summary.md"),
    );
    assert.equal(baseline.status, 1, baseline.output);
    assert.equal(current.status, baseline.status, current.output);
    for (const result of [baseline, current]) {
      assert.match(result.output, /diagnostic-marker/);
      assert.match(result.output, /::error/);
      assert.match(result.output, /expected 1 to be 2/);
      assert.match(result.output, /fixture\.test\.mjs/);
    }
    const summary = read(join(dir, "summary.md"));
    assertCounts(summary, { Passed: 2, Failed: 1, Skipped: 2, Flaky: 1 });
    assert.match(summary, /diagnostic-marker/);
    assert(!summary.includes("### Summary")); // Native summary isn't duplicated.
    const broken = execute(
      cli,
      [
        "run",
        "--reporter=default",
        `--reporter=${reporter("vitest-summary.mjs")}`,
      ],
      dir,
      join(dir, "missing", "summary.md"),
    );
    assert.equal(broken.status, baseline.status, broken.output);
    assert.match(broken.output, /CI summary unavailable/);
    const passed = execute(
      cli,
      [
        "run",
        "-t",
        "^passed$",
        "--reporter=default",
        `--reporter=${reporter("vitest-summary.mjs")}`,
      ],
      dir,
      join(dir, "missing", "summary.md"),
    );
    assert.equal(passed.status, 0, passed.output);
  }));

function playwrightConfig(dir, summary, globalSetup) {
  const config = {
    testDir: dir,
    testMatch: "fixture.spec.mjs",
    workers: 1,
    retries: 1,
    timeout: 10_000,
    outputDir: join(dir, summary ? "results-current" : "results-baseline"),
    use: { trace: "on-first-retry" },
    reporter: [
      ["github"],
      [
        "json",
        { outputFile: join(dir, summary ? "current.json" : "baseline.json") },
      ],
    ],
  };
  if (summary) config.reporter.push([reporter("playwright-summary.mjs")]);
  if (globalSetup) config.globalSetup = globalSetup;
  const path = join(dir, "playwright.config.mjs");
  writeFileSync(path, `export default ${JSON.stringify(config)};`);
  return path;
}

test("real Playwright summary preserves native errors, source locations, retries and traces", () =>
  fixture((dir) => {
    writeFileSync(
      join(dir, "fixture.spec.mjs"),
      `
import { test, expect } from ${JSON.stringify(pathToFileURL(join(playwright, "index.mjs")).href)};
test("passed", () => expect(1).toBe(1));
test.skip("skipped", () => {});
test("expected failure", () => { test.fail(); expect(1).toBe(2); });
test("flaky", ({}, info) => expect(info.retry).toBe(1));
test("diagnostic-marker", () => expect(1).toBe(2));
`,
    );
    const cli = join(playwright, "cli.js");
    const baseline = execute(
      cli,
      ["test", "--config", playwrightConfig(dir, false), "--shard=1/1"],
      dir,
      join(dir, "baseline.md"),
    );
    const current = execute(
      cli,
      ["test", "--config", playwrightConfig(dir, true), "--shard=1/1"],
      dir,
      join(dir, "summary.md"),
    );
    assert.equal(baseline.status, 1, baseline.output);
    assert.equal(current.status, baseline.status, current.output);
    for (const result of [baseline, current]) {
      assert.match(result.output, /::error/);
      assert.match(result.output, /diagnostic-marker/);
      assert.match(result.output, /Expected: 2/);
      assert.match(result.output, /fixture\.spec\.mjs/);
      assert.match(result.output, /Retry #1/);
      assert.match(result.output, /trace\.zip/);
    }
    const native = JSON.parse(read(join(dir, "current.json")));
    assert.equal(native.stats.expected, 2);
    assert.equal(native.stats.unexpected, 1);
    assert.equal(native.stats.skipped, 1);
    assert.equal(native.stats.flaky, 1);
    assertCounts(read(join(dir, "summary.md")), {
      Passed: 2,
      Failed: 1,
      Skipped: 1,
      Flaky: 1,
    });
    assert.match(read(join(dir, "summary.md")), /shard 1\/1/);
    const traces = readdirSync(join(dir, "results-current"), {
      recursive: true,
    }).filter((file) => file.endsWith("trace.zip"));
    assert.equal(traces.length, 2);
    const passed = execute(
      cli,
      ["test", "--config", playwrightConfig(dir, true), "--grep", "passed$"],
      dir,
      join(dir, "missing", "summary.md"),
    );
    assert.equal(passed.status, 0, passed.output);
    assert.match(passed.output, /CI summary unavailable/);
  }));

test("Playwright setup errors remain failures and are not invented test failures", () =>
  fixture((dir) => {
    const setup = join(dir, "setup.mjs");
    writeFileSync(
      join(dir, "fixture.spec.mjs"),
      `import { test } from ${JSON.stringify(pathToFileURL(join(playwright, "index.mjs")).href)}; test("never runs", () => {});`,
    );
    writeFileSync(
      setup,
      'export default () => { throw new Error("setup-diagnostic-marker"); };',
    );
    const cli = join(playwright, "cli.js");
    const result = execute(
      cli,
      ["test", "--config", playwrightConfig(dir, true, setup)],
      dir,
      join(dir, "summary.md"),
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /::error.*setup-diagnostic-marker/);
    const summary = read(join(dir, "summary.md"));
    assert.match(summary, /Conclusão do Playwright: failed/);
    assert.match(summary, /Erros fora de testes: 1/);
    assert(!summary.includes("| Failed | 1 |"));
  }));
