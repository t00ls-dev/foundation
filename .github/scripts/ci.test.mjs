import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { parse } from "yaml";
const ciSetup = () =>
  parse(readFileSync(".github/actions/setup/action.yml", "utf8"));
const currentCi = () => parse(readFileSync(".github/workflows/ci.yml", "utf8"));
const validationCommands = {
  "static": ["pnpm format:check", "pnpm lint", "pnpm typecheck"],
  "tests": [
    "pnpm exec turbo run test --filter='!levi' -- --reporter=default --reporter=\"$GITHUB_WORKSPACE/.github/scripts/vitest-summary.mjs\"",
    "pnpm exec turbo run test:integration --filter='!levi' -- --reporter=default --reporter=\"$GITHUB_WORKSPACE/.github/scripts/vitest-summary.mjs\"",
    "pnpm build",
    "pnpm test:workspace",
    "pnpm test:operations",
  ],
  "levi-tests": [
    "pnpm exec turbo run build --filter=levi",
    "pnpm --filter levi test",
    "pnpm --filter levi worker:build",
    "pnpm --filter levi test:integration",
    "pnpm --filter levi test:integration --runtime-acls",
    "pnpm --filter levi test:worker --runtime-acls",
  ],
  "levi-e2e": [
    "pnpm exec turbo run build --filter=levi",
    "pnpm --filter levi exec playwright install --with-deps chromium",
    "pnpm --filter levi test:e2e --runtime-acls",
  ],
};

// Compare executable YAML objects, not text occurrences. Any new execution
// condition, shell, environment override or dependency requires explicit review.
function validateCiStructure(ci, setup) {
  assert.deepEqual(ci.on, {
    pull_request: null,
    push: { branches: ["master"] },
  });
  assert.deepEqual(ci.permissions, { contents: "read" });
  assert.equal(ci.env, undefined);
  assert.equal(ci.defaults, undefined);
  assert.deepEqual(ci.concurrency, {
    "group": "ci-${{ github.ref }}",
    "cancel-in-progress": true,
  });
  const jobs = structuredClone(ci.jobs);
  for (const job of Object.values(jobs))
    for (const step of job.steps) delete step.name;
  assert.deepEqual(Object.keys(jobs).sort(), [
    "checks",
    "levi-e2e",
    "levi-tests",
    "static",
    "tests",
  ]);
  assert.equal(
    Object.values(jobs).filter((j) => j.name === "checks").length,
    0,
  );
  for (const [name, commands] of Object.entries(validationCommands)) {
    const expected = {
      "runs-on": "ubuntu-latest",
      "steps": [
        { uses: "actions/checkout@v7", with: { "fetch-depth": 0 } },
        { uses: "./.github/actions/setup" },
        ...commands.map((run) => ({ run })),
      ],
    };
    if (name === "tests") {
      expected.steps[2].env = { GITHUB_TEST_SUITE: "Unitários" };
      expected.steps[3].env = { GITHUB_TEST_SUITE: "Integração" };
    }

    if (name === "levi-tests" || name === "levi-e2e") {
      expected["timeout-minutes"] = name === "levi-tests" ? 20 : 15;
      expected.env = {
        WRANGLER_WRITE_LOGS: "false",
        WRANGLER_SEND_METRICS: "false",
      };
      expected.steps[0].with["persist-credentials"] = false;
    }
    assert.deepEqual(jobs[name], expected, `Required validation job: ${name}`);
  }
  assert.deepEqual(jobs.checks, {
    "if": "always()",
    "needs": Object.keys(validationCommands),
    "runs-on": "ubuntu-latest",
    "steps": [
      { uses: "actions/checkout@v7" },
      {
        run: "node .github/scripts/ci-checks.mjs",
        env: { CI_NEEDS: "${{ toJSON(needs) }}" },
      },
    ],
  });
  assert.deepEqual(setup.runs, {
    using: "composite",
    steps: [
      { uses: "pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413" },
      {
        uses: "actions/setup-node@v7",
        with: { "node-version": "22.23.3", "cache": "pnpm" },
      },
      { run: "pnpm install --frozen-lockfile", shell: "bash" },
    ],
  });
  const local = JSON.parse(readFileSync("package.json", "utf8")).scripts.check;
  assert.equal(
    local,
    "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e && pnpm test:workspace && pnpm test:operations && pnpm test:levi:runtime",
  );
}

test("CI structural guard covers the complete local gate", () =>
  validateCiStructure(currentCi(), ciSetup()));
for (const name of Object.keys(validationCommands)) {
  for (const [index] of validationCommands[name].entries()) {
    for (const mutation of ["remove", "disable", "ignore", "mask"]) {
      test(`CI guard rejects ${name} command ${index}: ${mutation}`, () => {
        const ci = currentCi();
        const steps = ci.jobs[name].steps;
        const step = steps[index + 2];
        if (mutation === "remove") steps.splice(index + 2, 1);
        if (mutation === "disable") step.if = "false";
        if (mutation === "ignore") step["continue-on-error"] = true;
        if (mutation === "mask") step.run += " || true";
        assert.throws(() => validateCiStructure(ci, ciSetup()));
      });
    }
  }
  for (const mutation of [
    "remove",
    "detach",
    "condition",
    "dependency",
    "ignore",
  ]) {
    test(`CI guard rejects ${name} job: ${mutation}`, () => {
      const ci = currentCi();
      if (mutation === "remove") delete ci.jobs[name];
      if (mutation === "detach")
        ci.jobs.checks.needs = ci.jobs.checks.needs.filter((n) => n !== name);
      if (mutation === "condition") ci.jobs[name].if = "false";
      if (mutation === "dependency") ci.jobs[name].needs = "version";
      if (mutation === "ignore") ci.jobs[name]["continue-on-error"] = true;
      assert.throws(() => validateCiStructure(ci, ciSetup()));
    });
  }
}
for (const mutate of [
  (ci) => {
    ci.jobs.checks.if = "success()";
  },
  (ci) => {
    ci.jobs.checks.steps[1].if = "false";
  },
  (ci) => {
    ci.jobs.checks.steps[1].run = "true";
  },
  (ci) => {
    ci.jobs.static.name = "checks";
  },
  (ci) => {
    ci.on = { workflow_dispatch: null };
  },
]) {
  test(`CI guard rejects altered execution contract: ${mutate.toString()}`, () => {
    const ci = currentCi();
    mutate(ci);
    assert.throws(() => validateCiStructure(ci, ciSetup()));
  });
}
test("CI guard rejects disabled or missing dependency installation", () => {
  for (const mutation of ["disable", "remove"]) {
    const setup = ciSetup();
    if (mutation === "disable") setup.runs.steps[2].if = "false";
    else setup.runs.steps.pop();
    assert.throws(() => validateCiStructure(currentCi(), setup));
  }
});
test("checks fails closed on every unsuccessful or missing dependency", () => {
  const needs = Object.fromEntries(
    Object.keys(validationCommands).map((name) => [
      name,
      { result: "success" },
    ]),
  );
  const run = (value) =>
    execFileSync(process.execPath, [".github/scripts/ci-checks.mjs"], {
      env: { ...process.env, CI_NEEDS: JSON.stringify(value) },
      stdio: "pipe",
    });
  run(needs);
  for (const name of Object.keys(needs)) {
    for (const result of ["failure", "cancelled", "skipped", "neutral", null])
      assert.throws(() => run({ ...needs, [name]: { result } }));
    const missing = { ...needs };
    delete missing[name];
    assert.throws(() => run(missing));
  }
  assert.throws(() => run({ ...needs, unexpected: { result: "success" } }));
});

import {
  approvedCi,
  validateCiRun,
  validateDeployEvent,
} from "./ci-evidence.mjs";
const sha = "a".repeat(40);
const ciWorkflow = () => ({ id: 123, path: ".github/workflows/ci.yml" });
const ciRun = () => ({
  id: 100,
  run_attempt: 2,
  workflow_id: 123,
  path: ".github/workflows/ci.yml",
  repository: { full_name: "t00ls-dev/foundation" },
  head_repository: { full_name: "t00ls-dev/foundation" },
  event: "push",
  head_branch: "master",
  head_sha: sha,
  status: "completed",
  conclusion: "success",
});
const ciJob = () => ({
  name: "checks",
  run_id: 100,
  run_attempt: 2,
  head_sha: sha,
  status: "completed",
  conclusion: "success",
});

test("CI evidence accepts only the exact completed master push and checks attempt", () => {
  assert.deepEqual(validateCiRun(ciRun(), [ciJob()], ciWorkflow(), sha), {
    runId: 100,
    attempt: 2,
    sha,
  });
  for (const patch of [
    { repository: { full_name: "attacker/foundation" } },
    { head_repository: { full_name: "attacker/foundation" } },
    { head_repository: null },
    { workflow_id: 999 },
    { path: ".github/workflows/fake.yml" },
    { event: "pull_request" },
    { event: "workflow_dispatch" },
    { head_branch: "feature" },
    { head_sha: "b".repeat(40) },
    { status: "in_progress" },
    ...["failure", "cancelled", "skipped", "neutral", null].map(
      (conclusion) => ({ conclusion }),
    ),
    { run_attempt: 0 },
    { id: undefined },
  ])
    assert.throws(() =>
      validateCiRun({ ...ciRun(), ...patch }, [ciJob()], ciWorkflow(), sha),
    );
  for (const patch of [
    { name: "version" },
    { run_id: 999 },
    { run_attempt: 1 },
    { head_sha: "b".repeat(40) },
    { status: "in_progress" },
    ...["failure", "cancelled", "skipped", "neutral", null].map(
      (conclusion) => ({ conclusion }),
    ),
  ])
    assert.throws(() =>
      validateCiRun(ciRun(), [{ ...ciJob(), ...patch }], ciWorkflow(), sha),
    );
  for (const jobs of [[], [ciJob(), ciJob()], null])
    assert.throws(() => validateCiRun(ciRun(), jobs, ciWorkflow(), sha));
  assert.throws(() =>
    validateCiRun(
      ciRun(),
      [ciJob()],
      { ...ciWorkflow(), path: "fake.yml" },
      sha,
    ),
  );
  assert.throws(() =>
    validateCiRun(ciRun(), [ciJob()], ciWorkflow(), "master"),
  );
});

test("deploy event rejects PRs, forks, incomplete runs and invalid SHAs before checkout", () => {
  const event = { repository: ciRun().repository, workflow_run: ciRun() };
  assert.equal(validateDeployEvent(event).head_sha, sha);
  assert.throws(() =>
    validateDeployEvent({
      ...event,
      repository: { full_name: "attacker/foundation" },
    }),
  );
  assert.throws(() =>
    validateDeployEvent({ ...event, workflow_run: undefined }),
  );
  for (const patch of [
    { repository: { full_name: "attacker/foundation" } },
    { head_repository: { full_name: "attacker/foundation" } },
    { event: "pull_request" },
    { head_branch: "feature" },
    { head_sha: "master; malicious" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { id: 0 },
    { run_attempt: undefined },
  ])
    assert.throws(() =>
      validateDeployEvent({ ...event, workflow_run: { ...ciRun(), ...patch } }),
    );
});

test("CI lookup binds workflow, newest run, attempt jobs and fails closed on API errors or reruns", async () => {
  const requests = [];
  const request = async (url) => {
    requests.push(url);
    if (url.endsWith("/actions/workflows/ci.yml")) return ciWorkflow();
    if (url.includes("/runs?"))
      return { workflow_runs: [ciRun(), { ...ciRun(), id: 99 }] };
    if (url.includes("/jobs?")) return { jobs: [ciJob()] };
    return ciRun();
  };
  await approvedCi(sha, { request });
  assert(
    requests.some((url) =>
      url.includes(`head_sha=${sha}&event=push&branch=master`),
    ),
  );
  assert(requests.some((url) => url.includes("/runs/100/attempts/2/jobs?")));
  assert(!requests.some((url) => url.includes("/runs/99")));
  for (const override of [
    async () => {
      throw new Error("403");
    },
    async (url) =>
      url.includes("/runs?") ? { workflow_runs: [] } : request(url),
    async (url) => (url.includes("/runs?") ? {} : request(url)),
    async (url) =>
      url.endsWith("/runs/100")
        ? { ...ciRun(), conclusion: "failure" }
        : request(url),
    async (url) => (url.includes("/jobs?") ? { jobs: [] } : request(url)),
  ])
    await assert.rejects(approvedCi(sha, { request: override }));
  let reads = 0;
  await assert.rejects(
    approvedCi(sha, {
      request: async (url) => {
        if (url.endsWith("/runs/100") && ++reads === 2)
          return { ...ciRun(), run_attempt: 3 };
        return request(url);
      },
    }),
  );
  await assert.rejects(
    approvedCi(sha, { request, origin: { ...ciRun(), run_attempt: 1 } }),
  );
  await approvedCi(sha, { request, origin: ciRun() });
});

test("CI evidence paginates attempt jobs and rejects a newly created run", async () => {
  let lists = 0;
  const requestedPages = [];
  const request = async (url) => {
    if (url.endsWith("/actions/workflows/ci.yml")) return ciWorkflow();
    if (url.includes("/runs?")) {
      lists++;
      return { workflow_runs: [ciRun()] };
    }
    if (url.includes("/jobs?")) {
      const page = Number(new URL(url).searchParams.get("page"));
      requestedPages.push(page);
      return {
        jobs:
          page === 1
            ? Array.from({ length: 100 }, (_, index) => ({
                name: `other-${index}`,
              }))
            : [ciJob()],
      };
    }
    return ciRun();
  };
  await approvedCi(sha, { request });
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(lists, 2);
  lists = 0;
  await assert.rejects(
    approvedCi(sha, {
      request: async (url) => {
        const value = await request(url);
        if (url.includes("/runs?") && lists === 2)
          return { workflow_runs: [{ ...ciRun(), id: 101 }] };
        return value;
      },
    }),
  );
});
