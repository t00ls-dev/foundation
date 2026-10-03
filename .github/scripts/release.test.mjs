import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { runInNewContext } from "node:vm";
import {
  authenticatedJson,
  confirmation,
  digest,
  envelopeDigest,
  hash,
  names,
  reconcile,
  remainingPlan,
  validateContext,
  validateManifests,
  validatePacket,
  validatePr,
  validateRecord,
  validatePublishPlan,
  recordFromStatus,
  validateArtifactPath,
  validateReleaseCommit,
  validateRecordPlan,
  validatePackument,
  registryInventory,
  infrastructurePaths,
  protectedInputs,
  validateProtectedInputs,
  validateAncestry,
  validateAuditRun,
} from "./release-core.mjs";
import {
  recordFromBase,
  contentBinding,
  treeAtCommit,
} from "./release-planning.mjs";
import {
  approvedCi,
  validateCiRun,
  validateDeployEvent,
} from "./ci-evidence.mjs";

const sha = "a".repeat(40);
const record = () => ({
  format: 1,
  repository: "t00ls-dev/foundation",
  cliVersion: "3.0.3",
  baseSha: "b".repeat(40),
  changesets: [{ id: "patch-access", hash: "c".repeat(64) }],
  packages: [
    {
      name: names[0],
      oldVersion: "0.1.0",
      version: "0.1.1",
      type: "patch",
      changesets: ["patch-access"],
      reason: "changeset",
      dependencies: [],
    },
  ],
});
const context = () => ({
  event: "workflow_dispatch",
  ref: "refs/heads/master",
  repository: "t00ls-dev/foundation",
  sha,
  releaseSha: sha,
  executionSha: sha,
  protectedInputsDigest: "e".repeat(64),
  masterSha: sha,
  mode: "publish",
  releasePr: 25,
  confirmation,
  planDigest: "d".repeat(64),
  auditRun: 100,
});
const pr = () => ({
  number: 25,
  state: "closed",
  merged: true,
  base: { ref: "master", repo: { full_name: "t00ls-dev/foundation" } },
  head: {
    sha,
    ref: "changeset-release/master",
    repo: { full_name: "t00ls-dev/foundation" },
  },
  merge_commit_sha: sha,
  user: { login: "github-actions[bot]" },
});
const artifacts = () => [
  {
    name: names[0],
    version: "0.1.1",
    path: "packages/t00ls-dev-access-0.1.1.tgz",
    hash: "f".repeat(64),
    integrity: "sha512-YWJj",
    packIntegrity: "sha256-YWJj",
  },
];
const packet = () => ({
  format: 2,
  repository: "t00ls-dev/foundation",
  releasePr: 25,
  releaseSha: sha,
  executionSha: sha,
  protectedInputsDigest: "e".repeat(64),
  record: record(),
  auditRun: 100,
  artifacts: artifacts(),
});
const registry = (versions = ["0.1.0"], latest = versions.at(-1)) => ({
  [names[0]]: {
    name: names[0],
    versions,
    latest,
    integrities: { "0.1.1": "sha512-YWJj" },
  },
});
const invalid = (name, fn) => test(name, () => assert.throws(fn));

function inputTree() {
  const paths = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".changeset/release-plan.json",
    "turbo.json",
    ".npmrc",
    "tests/distribution.mjs",
    "tooling/typescript-config/base.json",
    ".github/workflows/ci.yml",
    ".github/workflows/deploy-dev.yml",
    ".github/scripts/ci-evidence.mjs",
    ".github/scripts/release-version.mjs",
    ...names.flatMap((name) => {
      const dir = `packages/${name.split("/")[1]}`;
      return [
        `${dir}/package.json`,
        `${dir}/CHANGELOG.md`,
        `${dir}/src/index.ts`,
        `${dir}/tsconfig.build.json`,
        `${dir}/README.md`,
      ];
    }),
    ...infrastructurePaths,
  ];
  return {
    sha: "c".repeat(40),
    truncated: false,
    tree: paths.map((path) => ({
      path,
      mode: "100644",
      type: "blob",
      sha: hash(Buffer.from(path), "sha1"),
    })),
  };
}
const ancestry = (releaseSha = sha, executionSha = "d".repeat(40)) => ({
  base_commit: { sha: releaseSha },
  merge_base_commit: { sha: releaseSha },
  behind_by: 0,
  status: releaseSha === executionSha ? "identical" : "ahead",
});
test("equal release/execution SHA and protected tree are valid", () => {
  assert.deepEqual(infrastructurePaths, [
    ".github/workflows/release.yml",
    ".github/scripts/release-core.mjs",
    ".github/scripts/release.mjs",
    ".github/scripts/release-planning.mjs",
    ".github/scripts/release.test.mjs",
    "docs/runbooks/packages.md",
  ]);
  validateContext(context(), true);
  validateAncestry(ancestry(sha, sha), sha, sha);
  const tree = inputTree();
  assert.equal(
    validateProtectedInputs(tree, tree),
    digest(protectedInputs(tree)),
  );
});
test("descendant executor may change exactly the six regular infrastructure files", () => {
  const original = inputTree(),
    execution = structuredClone(original);
  execution.tree.push({
    path: ".github",
    type: "tree",
    mode: "040000",
    sha: "f".repeat(40),
  });
  for (const file of execution.tree)
    if (infrastructurePaths.includes(file.path)) file.sha = "d".repeat(40);
  execution.tree.reverse();
  validateAncestry(ancestry(), sha, "d".repeat(40));
  assert.equal(
    validateProtectedInputs(original, execution),
    digest(protectedInputs(original)),
  );
});
test("all protected entries including manifests/source/build/lock/config reject byte changes", () => {
  const original = inputTree();
  for (const path of protectedInputs(original).map((entry) => entry.path)) {
    const execution = structuredClone(original);
    execution.tree.find((file) => file.path === path).sha = "f".repeat(40);
    assert.throws(
      () => validateProtectedInputs(original, execution),
      undefined,
      path,
    );
  }
});
for (const [label, mutate] of [
  [
    "addition",
    (tree) =>
      tree.tree.push({
        path: "packages/access/src/new.ts",
        type: "blob",
        mode: "100644",
        sha,
      }),
  ],
  [
    "removal",
    (tree) => {
      tree.tree = tree.tree.filter(
        (file) => file.path !== "packages/access/src/index.ts",
      );
    },
  ],
  [
    "rename",
    (tree) => {
      tree.tree.find(
        (file) => file.path === "packages/access/src/index.ts",
      ).path = "packages/access/src/renamed.ts";
    },
  ],
  [
    "mode",
    (tree) => {
      tree.tree.find(
        (file) => file.path === "packages/access/src/index.ts",
      ).mode = "100755";
    },
  ],
  [
    "symlink",
    (tree) => {
      tree.tree[0].mode = "120000";
    },
  ],
  [
    "gitlink",
    (tree) => {
      tree.tree[0].type = "commit";
      tree.tree[0].mode = "160000";
    },
  ],
  [
    "infrastructure symlink",
    (tree) => {
      tree.tree.find((file) => file.path === infrastructurePaths[1]).mode =
        "120000";
    },
  ],
  [
    "infrastructure directory",
    (tree) => {
      const file = tree.tree.find(
        (file) => file.path === infrastructurePaths[1],
      );
      file.mode = "040000";
      file.type = "tree";
    },
  ],
  [
    "directory exception expansion",
    (tree) =>
      tree.tree.push({
        path: ".github/scripts/other.mjs",
        type: "blob",
        mode: "100644",
        sha,
      }),
  ],
  [
    "workflow exception expansion",
    (tree) =>
      tree.tree.push({
        path: ".github/workflows/other.yml",
        type: "blob",
        mode: "100644",
        sha,
      }),
  ],
  [
    "truncated API tree",
    (tree) => {
      tree.truncated = true;
    },
  ],
  [
    "empty API tree",
    (tree) => {
      tree.tree = [];
    },
  ],
  [
    "missing object ID",
    (tree) => {
      delete tree.tree[0].sha;
    },
  ],
  ["duplicate path", (tree) => tree.tree.push({ ...tree.tree[0] })],
])
  invalid(`protected-input projection rejects ${label}`, () => {
    const tree = inputTree();
    mutate(tree);
    validateProtectedInputs(inputTree(), tree);
  });
for (const [label, mutate] of [
  [
    "wrong merge base",
    (comparison) => {
      comparison.merge_base_commit.sha = "b".repeat(40);
    },
  ],
  [
    "wrong requested base",
    (comparison) => {
      comparison.base_commit.sha = "b".repeat(40);
    },
  ],
  [
    "diverged",
    (comparison) => {
      comparison.status = "diverged";
    },
  ],
  [
    "behind",
    (comparison) => {
      comparison.behind_by = 1;
    },
  ],
  [
    "incomplete API",
    (comparison) => {
      delete comparison.merge_base_commit;
    },
  ],
])
  invalid(`release ancestry rejects ${label}`, () => {
    const comparison = ancestry();
    mutate(comparison);
    validateAncestry(comparison, sha, "d".repeat(40));
  });
test("real binding loader uses immutable commit/tree API identities", async () => {
  const executionSha = "d".repeat(40),
    original = inputTree(),
    execution = structuredClone(original);
  execution.sha = "e".repeat(40);
  execution.tree.find((file) => file.path === infrastructurePaths[1]).sha =
    "f".repeat(40);
  const routes = new Map([
    [`/compare/${sha}...${executionSha}`, ancestry()],
    [`/git/commits/${sha}`, { sha, tree: { sha: original.sha } }],
    [
      `/git/commits/${executionSha}`,
      { sha: executionSha, tree: { sha: execution.sha } },
    ],
    [`/git/trees/${original.sha}?recursive=1`, original],
    [`/git/trees/${execution.sha}?recursive=1`, execution],
  ]);
  const binding = await contentBinding(sha, executionSha, async (url) => {
    const key = url.replace(
      "https://api.github.com/repos/t00ls-dev/foundation",
      "",
    );
    assert(routes.has(key), key);
    return routes.get(key);
  });
  assert.equal(
    binding.protectedInputsDigest,
    digest(protectedInputs(original)),
  );
  await assert.rejects(
    treeAtCommit(sha, async () => ({ sha: executionSha })),
    /commit lookup mismatch/,
  );
  await assert.rejects(
    treeAtCommit(sha, async (url) =>
      url.includes("/commits/")
        ? { sha, tree: { sha: original.sha } }
        : { ...original, sha: execution.sha },
    ),
    /tree lookup mismatch/,
  );
  await assert.rejects(
    contentBinding(sha, executionSha, async () => {
      throw new Error("API unavailable");
    }),
  );
});
test("repository fixture equivalent to #25 content plus #27 permitted delta", () => {
  const tree = {
    sha: execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      encoding: "utf8",
    }).trim(),
    truncated: false,
    tree: execFileSync("git", ["ls-tree", "-r", "-z", "HEAD"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const split = line.indexOf("\t");
        const [mode, type, sha] = line.slice(0, split).split(" ");
        return { path: line.slice(split + 1), mode, type, sha };
      }),
  };
  const execution = structuredClone(tree);
  for (const path of [
    ".github/scripts/release-core.mjs",
    ".github/scripts/release.mjs",
    ".github/scripts/release.test.mjs",
    "docs/runbooks/packages.md",
  ])
    execution.tree.find((file) => file.path === path).sha = "f".repeat(40);
  assert.equal(
    validateProtectedInputs(tree, execution),
    digest(protectedInputs(tree)),
  );
});
test("release PR binds content SHA while context binds current executor SHA", () => {
  const c = {
    ...context(),
    executionSha: "d".repeat(40),
    sha: "d".repeat(40),
    masterSha: "d".repeat(40),
  };
  validateContext(c, true);
  validatePr(pr(), c, record());
  assert.throws(
    () => validatePr(pr(), { ...c, releaseSha: "c".repeat(40) }, record()),
    /release_sha/,
  );
  assert.throws(
    () => validateContext({ ...c, masterSha: "f".repeat(40) }, true),
    /master moved/,
  );
  assert.throws(() =>
    validateContext({ ...c, ref: "refs/heads/feature" }, true),
  );
});
for (const [label, values] of [
  ["old internal field", { expectedSha: sha }],
  ["old input", { expected_sha: sha }],
  ["old env/event input", { legacyExpectedSha: sha }],
])
  invalid(`legacy expected_sha rejected clearly: ${label}`, () =>
    validateContext({ ...context(), ...values }),
  );
test("resume binds both SHAs and original protected inputs/artifacts", () => {
  const p = packet(),
    c = {
      ...context(),
      mode: "resume",
      executionSha: "d".repeat(40),
      sha: "d".repeat(40),
      masterSha: "d".repeat(40),
    };
  p.executionSha = c.executionSha;
  c.planDigest = envelopeDigest(p);
  validateContext(c, true);
  validatePacket(p, c, record());
  for (const mutate of [
    (p) => {
      p.releaseSha = "f".repeat(40);
    },
    (p) => {
      p.executionSha = "f".repeat(40);
    },
    (p) => {
      p.protectedInputsDigest = "f".repeat(64);
    },
    (p) => {
      p.record.packages[0].version = "0.2.0";
    },
    (p) => {
      p.artifacts[0].hash = "e".repeat(64);
    },
    (p) => {
      p.artifacts[0].integrity = sri("changed");
    },
    (p) => {
      p.auditRun++;
    },
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    assert.throws(() => validatePacket(changed, c, record()));
  }
  const newExecutor = {
    ...c,
    executionSha: "f".repeat(40),
    sha: "f".repeat(40),
    masterSha: "f".repeat(40),
  };
  validateContext(newExecutor, true);
  assert.throws(
    () => validatePacket(p, newExecutor, record()),
    /execution SHA/,
  );
  const changed = structuredClone(p);
  changed.executionSha = newExecutor.executionSha;
  assert.notEqual(envelopeDigest(changed), c.planDigest);
  assert.throws(
    () => validatePacket(changed, newExecutor, record()),
    /digest mismatch/,
  );
  assert.throws(
    () => validateContext({ ...c, masterSha: "f".repeat(40) }, true),
    /master moved/,
  );
  assert.throws(
    () => validatePacket({ ...p, format: 1 }, c, record()),
    /Legacy/,
  );
});
test("audit run provenance binds execution SHA, not historical release SHA", () => {
  const c = { ...context(), executionSha: "d".repeat(40) };
  const audit = {
    id: c.auditRun,
    event: "workflow_dispatch",
    conclusion: "success",
    head_branch: "master",
    head_sha: c.executionSha,
    workflow_id: 123,
  };
  const jobs = [{ name: "audit", conclusion: "success" }];
  validateAuditRun(audit, jobs, 123, c);
  assert.throws(() =>
    validateAuditRun({ ...audit, head_sha: c.releaseSha }, jobs, 123, c),
  );
  assert.throws(() =>
    validateAuditRun({ ...audit, id: c.auditRun + 1 }, jobs, 123, c),
  );
  assert.throws(() =>
    validateAuditRun(audit, [{ name: "audit", conclusion: "failure" }], 123, c),
  );
});

const sri = (value) => `sha512-${hash(Buffer.from(value), "sha512", "base64")}`;
const packument = (
  name = names[0],
  versions = ["0.1.0"],
  latest = versions.at(-1),
) => ({
  name,
  "dist-tags": { latest },
  "versions": Object.fromEntries(
    versions.map((version) => [
      version,
      {
        name,
        version,
        dist: {
          integrity: sri(`${name}@${version}`),
          tarball: `https://npm.pkg.github.com/download/${name}/${version}/fixture`,
        },
      },
    ]),
  ),
});
test("valid packument yields only observed registry facts, no administrative claims", () => {
  const result = validatePackument(packument(), names[0]);
  assert.deepEqual(result, {
    name: names[0],
    versions: ["0.1.0"],
    latest: "0.1.0",
    integrities: { "0.1.0": sri(`${names[0]}@0.1.0`) },
  });
  assert(
    !("visibility" in result) &&
      !("repositoryAssociation" in result) &&
      !("repository" in result),
  );
});
test("real inventory queries all nine npm packuments directly with authenticated full metadata", async () => {
  const urls = [];
  const result = await registryInventory(
    "fixture-token",
    async (url, options) => {
      urls.push(url);
      assert.equal(new URL(url).origin, "https://npm.pkg.github.com");
      assert.equal(options.headers.Authorization, "Bearer fixture-token");
      assert.equal(options.headers.Accept, "application/json");
      assert.equal(options.redirect, "error");
      assert(options.signal instanceof AbortSignal);
      const name = decodeURIComponent(new URL(url).pathname.slice(1));
      return { ok: true, status: 200, json: async () => packument(name) };
    },
  );
  assert.deepEqual(
    urls,
    names.map(
      (name) => `https://npm.pkg.github.com/${name.replace("/", "%2F")}`,
    ),
  );
  assert.deepEqual(Object.keys(result), names);
  assert.equal(reconcile(record(), result)[0].state, "absent");
});
for (const [label, mutate] of [
  [
    "wrong package",
    (p) => {
      p.name = names[1];
    },
  ],
  [
    "wrong namespace",
    (p) => {
      p.name = "@other/access";
    },
  ],
  [
    "missing versions",
    (p) => {
      delete p.versions;
    },
  ],
  [
    "empty versions",
    (p) => {
      p.versions = {};
    },
  ],
  [
    "missing dist-tags",
    (p) => {
      delete p["dist-tags"];
    },
  ],
  [
    "invalid latest",
    (p) => {
      p["dist-tags"].latest = "0.1.1";
    },
  ],
  [
    "wrong version package",
    (p) => {
      p.versions["0.1.0"].name = names[1];
    },
  ],
  [
    "wrong version identity",
    (p) => {
      p.versions["0.1.0"].version = "0.1.1";
    },
  ],
  [
    "missing dist",
    (p) => {
      delete p.versions["0.1.0"].dist;
    },
  ],
  [
    "missing integrity",
    (p) => {
      delete p.versions["0.1.0"].dist.integrity;
    },
  ],
  [
    "invalid integrity",
    (p) => {
      p.versions["0.1.0"].dist.integrity = "sha512-short";
    },
  ],
  [
    "missing tarball",
    (p) => {
      delete p.versions["0.1.0"].dist.tarball;
    },
  ],
  [
    "foreign tarball",
    (p) => {
      p.versions["0.1.0"].dist.tarball = "https://example.invalid/fixture.tgz";
    },
  ],
  [
    "wrong tarball package",
    (p) => {
      p.versions["0.1.0"].dist.tarball =
        `https://npm.pkg.github.com/download/${names[1]}/0.1.0/fixture`;
    },
  ],
  [
    "prerelease drift",
    (p) => {
      p.versions["0.2.0-beta.1"] = {};
    },
  ],
])
  invalid(`packument rejects ${label}`, () => {
    const p = packument();
    mutate(p);
    validatePackument(p, names[0]);
  });
for (const status of [401, 403, 404, 500, 503, 206])
  test(`inventory fails closed on HTTP ${status}, never onboards on 404`, async () => {
    await assert.rejects(
      registryInventory("fixture-token", async () => ({
        ok: status < 300,
        status,
        json: async () => packument(),
      })),
      /Authenticated request failed/,
    );
  });
test("inventory rejects network failure, timeout and invalid JSON", async () => {
  for (const failure of [
    new Error("network"),
    new DOMException("timeout", "TimeoutError"),
  ])
    await assert.rejects(
      registryInventory("fixture-token", async () => {
        throw failure;
      }),
    );
  await assert.rejects(
    registryInventory("fixture-token", async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("invalid JSON");
      },
    })),
  );
});
invalid(
  "registry anchor oldVersion missing is never treated as a new package",
  () =>
    reconcile(record(), {
      [names[0]]: validatePackument(packument(names[0], ["0.1.1"]), names[0]),
    }),
);
for (const mode of ["audit", "publish"])
  invalid(
    `validated packument target already present blocks normal ${mode}`,
    () => {
      const inventory = {
        [names[0]]: validatePackument(
          packument(names[0], ["0.1.0", "0.1.1"]),
          names[0],
        ),
      };
      const artifact = [
        { ...artifacts()[0], integrity: sri(`${names[0]}@0.1.1`) },
      ];
      remainingPlan(record(), reconcile(record(), inventory, artifact), mode);
    },
  );
test("validated packument resume accepts only original artifact integrity", () => {
  const inventory = {
    [names[0]]: validatePackument(
      packument(names[0], ["0.1.0", "0.1.1"]),
      names[0],
    ),
  };
  const artifact = [{ ...artifacts()[0], integrity: sri(`${names[0]}@0.1.1`) }];
  assert.deepEqual(
    remainingPlan(record(), reconcile(record(), inventory, artifact), "resume"),
    [],
  );
  artifact[0].integrity = sri("different bytes");
  assert.throws(
    () =>
      remainingPlan(
        record(),
        reconcile(record(), inventory, artifact),
        "resume",
      ),
    /divergence/,
  );
});

const commit = () => ({
  sha,
  author: { login: "github-actions[bot]" },
  committer: { login: "web-flow" },
  commit: { verification: { verified: true, reason: "valid" } },
  parents: [{ sha: record().baseSha }],
});
test("verified API-generated release commit matches PR head and single base parent", () =>
  validateReleaseCommit([commit()], pr(), record()));
for (const [label, change] of [
  [
    "head SHA",
    (c) => {
      c.sha = "c".repeat(40);
    },
  ],
  [
    "parent",
    (c) => {
      c.parents[0].sha = "c".repeat(40);
    },
  ],
  [
    "extra parent",
    (c) => {
      c.parents.push({ sha });
    },
  ],
  [
    "unsigned",
    (c) => {
      c.commit.verification.verified = false;
    },
  ],
  [
    "invalid signature",
    (c) => {
      c.commit.verification.reason = "invalid";
    },
  ],
  [
    "missing signature evidence",
    (c) => {
      delete c.commit.verification;
    },
  ],
  [
    "human committer with bot author",
    (c) => {
      c.committer.login = "human";
    },
  ],
])
  invalid(`release commit rejects ${label}`, () => {
    const c = commit();
    change(c);
    validateReleaseCommit([c], pr(), record());
  });

function baseSnapshot(overrides = {}) {
  const files = new Map([
    [
      "package.json",
      Buffer.from(
        JSON.stringify({
          name: "@t00ls-dev/release-fixture",
          version: "0.1.0",
          private: true,
          packageManager: "pnpm@10.15.1",
        }),
      ),
    ],
    ["pnpm-workspace.yaml", readFileSync("pnpm-workspace.yaml")],
    [".changeset/config.json", readFileSync(".changeset/config.json")],
    [
      ".changeset/fix-package-distribution.md",
      Buffer.from(
        `---\n${names.map((name) => `"${name}": patch`).join("\n")}\n---\nFixture: original nine-package patch release.\n`,
      ),
    ],
    ...names.map((name) => {
      const path = `packages/${name.split("/")[1]}/package.json`;
      return [path, Buffer.from(JSON.stringify({ name, version: "0.1.0" }))];
    }),
  ]);
  for (const [path, bytes] of Object.entries(overrides))
    files.set(path, Buffer.from(bytes));
  return {
    baseSha: record().baseSha,
    cliVersion: "3.0.3",
    tree: {
      truncated: false,
      tree: [...files.keys()].map((path) => ({
        path,
        type: "blob",
        mode: "100644",
      })),
    },
    content: async (path, ref) => {
      assert.equal(ref, record().baseSha);
      assert(files.has(path));
      return files.get(path);
    },
  };
}
test("independent planning uses original nine-package PATCH changeset and accepts correct record", async () => {
  const expected = await recordFromBase(baseSnapshot());
  assert.equal(expected.packages.length, 9);
  assert(
    expected.packages.every(
      (pkg) =>
        pkg.oldVersion === "0.1.0" &&
        pkg.version === "0.1.1" &&
        pkg.type === "patch",
    ),
  );
  validateRecordPlan(structuredClone(expected), expected);
});
test("regression: correct PATCH hash and bot author/parent cannot authorize access-only major", async () => {
  const expected = await recordFromBase(baseSnapshot());
  const forged = structuredClone(expected);
  forged.packages = [
    { ...forged.packages[0], type: "major", version: "1.0.0" },
  ];
  assert.equal(forged.changesets[0].hash, expected.changesets[0].hash);
  const unsigned = commit();
  unsigned.commit.verification.verified = false;
  assert.throws(() => validateReleaseCommit([unsigned], pr(), forged));
  // Even a verified commit cannot replace Changesets' independent derivation.
  validateReleaseCommit([commit()], pr(), forged);
  assert.throws(
    () => validateRecordPlan(forged, expected),
    /independently recalculated/,
  );
});
test("independent plan comparison rejects changed/omitted/extra packages, versions, bumps and changesets", async () => {
  const expected = await recordFromBase(baseSnapshot());
  for (const mutate of [
    (r) => {
      r.packages.pop();
    },
    (r) => {
      r.packages.push({ ...r.packages[0] });
    },
    (r) => {
      r.packages[0].name = "@t00ls-dev/unexpected";
    },
    (r) => {
      r.packages[0].oldVersion = "0.0.0";
      r.packages[0].type = "minor";
      r.packages[0].version = "0.1.0";
    },
    (r) => {
      r.packages[0].type = "minor";
      r.packages[0].version = "0.2.0";
    },
    (r) => {
      r.changesets[0].id = "different";
      r.packages.forEach((p) => {
        p.changesets = ["different"];
      });
    },
  ]) {
    const changed = structuredClone(expected);
    mutate(changed);
    assert.throws(() => validateRecordPlan(changed, expected));
  }
});
test("real Changesets planning derives internal dependency bump and rejects divergent derived record", async () => {
  const audit = {
    name: names[1],
    version: "0.1.0",
    dependencies: { [names[0]]: "workspace:^0.1.0" },
  };
  const expected = await recordFromBase(
    baseSnapshot({
      "packages/audit/package.json": JSON.stringify(audit),
      ".changeset/fix-package-distribution.md": `---\n"${names[0]}": minor\n---\nFixture dependency propagation.\n`,
    }),
  );
  const derived = expected.packages.find((pkg) => pkg.name === names[1]);
  assert.equal(derived.reason, "internal-dependency");
  assert.equal(derived.version, "0.1.1");
  assert.deepEqual(derived.dependencies, [names[0]]);
  validateRecordPlan(expected, expected);
  const changed = structuredClone(expected);
  changed.packages.find((pkg) => pkg.name === names[1]).version = "0.2.0";
  changed.packages.find((pkg) => pkg.name === names[1]).type = "minor";
  assert.throws(() => validateRecordPlan(changed, expected));
});
test("planning base fails closed on truncated tree, links and missing inputs", async () => {
  for (const mutate of [
    (s) => {
      s.tree.truncated = true;
    },
    (s) => {
      s.tree.tree[0].mode = "120000";
    },
    (s) => {
      s.tree.tree = s.tree.tree.filter(
        (file) => file.path !== ".changeset/config.json",
      );
    },
  ]) {
    const snapshot = baseSnapshot();
    mutate(snapshot);
    await assert.rejects(recordFromBase(snapshot));
  }
});

for (const [label, path] of [
  ["wrong version", "packages/t00ls-dev-access-0.1.2.tgz"],
  ["wrong package", "packages/t00ls-dev-audit-0.1.1.tgz"],
  ["traversal", "packages/../t00ls-dev-access-0.1.1.tgz"],
  ["absolute path", "/packages/t00ls-dev-access-0.1.1.tgz"],
  ["subdirectory", "packages/extra/t00ls-dev-access-0.1.1.tgz"],
  ["wrong extension", "packages/t00ls-dev-access-0.1.1.tar"],
  ["arbitrary filename", "packages/access.tgz"],
])
  invalid(`audit and preflight artifact rule rejects ${label}`, () => {
    const p = packet();
    p.artifacts[0].path = path;
    assert.throws(() => validateArtifactPath(p.artifacts[0]));
    validatePacket(
      p,
      { ...context(), planDigest: envelopeDigest(p) },
      record(),
    );
  });
invalid("unexpected extra artifact rejected even with matching digest", () => {
  const p = packet();
  p.artifacts.push({
    ...p.artifacts[0],
    name: names[1],
    path: "packages/t00ls-dev-audit-0.1.1.tgz",
  });
  validatePacket(p, { ...context(), planDigest: envelopeDigest(p) }, record());
});

test("record generation from Changesets status is deterministic, without versioning", () => {
  const status = {
    changesets: [{ id: "patch-access" }],
    releases: [
      {
        name: names[0],
        type: "patch",
        oldVersion: "0.1.0",
        newVersion: "0.1.1",
        changesets: ["patch-access"],
      },
      {
        name: names[1],
        type: "patch",
        oldVersion: "0.1.0",
        newVersion: "0.1.1",
        changesets: [],
      },
      { name: "@t00ls-dev/integration-tests", type: "none" },
    ],
  };
  const input = {
    baseSha: sha,
    cliVersion: "3.0.3",
    changesetBytes: () => Buffer.from("fixture changeset"),
    manifestByName: (name) => ({
      version: "0.1.0",
      dependencies: name === names[1] ? { [names[0]]: "workspace:*" } : {},
    }),
  };
  const first = recordFromStatus(status, input);
  assert.equal(first.packages.length, 2);
  assert.equal(first.packages[1].reason, "internal-dependency");
  assert.equal(
    first.changesets[0].hash,
    hash(Buffer.from("fixture changeset")),
  );
  assert.deepEqual(
    recordFromStatus(
      { ...status, releases: [...status.releases].reverse() },
      input,
    ),
    first,
  );
});

test("valid manual authorization and stable deterministic digest", () => {
  validateContext(context(), true);
  validatePr(pr(), context(), record());
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  const p = packet(),
    c = context();
  c.planDigest = envelopeDigest(p);
  validatePacket(p, c, record());
});
for (const [field, value] of [
  ["event", "push"],
  ["event", "pull_request"],
  ["ref", "refs/heads/feature"],
  ["sha", "c".repeat(40)],
  ["masterSha", "c".repeat(40)],
  ["releaseSha", "short"],
  ["executionSha", "short"],
  ["confirmation", "wrong"],
  ["mode", "automatic"],
  ["auditRun", 0],
])
  invalid(`reject context ${field}=${value}`, () =>
    validateContext({ ...context(), [field]: value }, true),
  );
invalid("PR missing", () => validatePr(null, context(), record()));
invalid("PR nonexistent/different", () =>
  validatePr({ ...pr(), number: 26 }, context(), record()),
);
invalid("PR not merged", () =>
  validatePr({ ...pr(), merged: false }, context(), record()),
);
invalid("wrong PR base", () => {
  const p = pr();
  p.base.ref = "feature";
  validatePr(p, context(), record());
});
invalid("wrong merge SHA", () =>
  validatePr(
    { ...pr(), merge_commit_sha: "c".repeat(40) },
    context(),
    record(),
  ),
);
invalid("unexpected package", () => {
  const r = record();
  r.packages[0].name = "@t00ls-dev/unexpected";
  validateRecord(r);
});
invalid("private tooling in plan", () => {
  const r = record();
  r.packages[0].name = "@t00ls-dev/typescript-config";
  validateRecord(r);
});
invalid("version not authorized by bump", () => {
  const r = record();
  r.packages[0].version = "0.2.0";
  validateRecord(r);
});
invalid("unexplained derived bump", () => {
  const r = record();
  r.packages[0].reason = "internal-dependency";
  r.packages[0].changesets = [];
  validateRecord(r);
});
test("valid internal dependency propagation", () => {
  const r = record();
  r.packages.push({
    ...r.packages[0],
    name: names[1],
    reason: "internal-dependency",
    changesets: [],
    dependencies: [names[0]],
  });
  validateRecord(r);
});
invalid("digest divergent", () =>
  validatePacket(packet(), context(), record()),
);
invalid("computed Changesets plan differs", () =>
  validatePublishPlan(
    {
      version: 1,
      plan: [
        [
          {
            name: names[1],
            version: "0.1.1",
            kind: "publish",
            access: "restricted",
            tag: "latest",
          },
        ],
      ],
    },
    record().packages,
  ),
);
invalid("resume different plan", () => {
  const p = packet(),
    c = context();
  c.planDigest = envelopeDigest(p);
  const r = record();
  r.packages[0].version = "0.1.2";
  validatePacket(p, c, r);
});
invalid("different audit run", () => {
  const p = packet(),
    c = context();
  c.planDigest = envelopeDigest(p);
  c.auditRun++;
  validatePacket(p, c, record());
});
invalid("unsafe artifact path", () => {
  const p = packet(),
    c = context();
  p.artifacts[0].path = "../secret.tgz";
  c.planDigest = envelopeDigest(p);
  validatePacket(p, c, record());
});
invalid("registry inaccessible", () => reconcile(record(), {}));
invalid("registry malformed/auth failure", () =>
  reconcile(record(), { [names[0]]: { error: "unauthorized" } }),
);
test("HTTP/auth/network failures are never absence", async () => {
  for (const status of [401, 403, 404, 500])
    await assert.rejects(
      authenticatedJson(
        "https://example.invalid/registry",
        "fake-test-token",
        async () => ({ ok: false, status, json: async () => ({}) }),
      ),
    );
  await assert.rejects(
    authenticatedJson(
      "https://example.invalid/registry",
      "fake-test-token",
      async () => {
        throw new Error("network unavailable");
      },
    ),
  );
  await assert.rejects(
    authenticatedJson("https://example.invalid/registry", "", async () => {
      throw new Error("must not fetch");
    }),
  );
});
invalid("registry package identity divergent", () => {
  const i = registry();
  i[names[0]].name = names[1];
  reconcile(record(), i);
});
invalid("downgrade", () =>
  remainingPlan(
    record(),
    reconcile(record(), registry(["0.1.0", "0.2.0"]), artifacts()),
    "resume",
  ),
);
invalid("already published in normal audit", () =>
  remainingPlan(
    record(),
    reconcile(record(), registry(["0.1.0", "0.1.1"]), artifacts()),
    "audit",
  ),
);
invalid("already published in initial publish", () =>
  remainingPlan(
    record(),
    reconcile(record(), registry(["0.1.0", "0.1.1"]), artifacts()),
    "publish",
  ),
);
invalid("published bytes differ", () => {
  const i = registry(["0.1.0", "0.1.1"]);
  i[names[0]].integrities["0.1.1"] = "sha512-other";
  remainingPlan(record(), reconcile(record(), i, artifacts()), "resume");
});
test("resume complete is reconciliation only", () =>
  assert.deepEqual(
    remainingPlan(
      record(),
      reconcile(record(), registry(["0.1.0", "0.1.1"]), artifacts()),
      "resume",
    ),
    [],
  ));
test("partial release publishes only absent remainder", () => {
  const r = record();
  r.packages.push({ ...r.packages[0], name: names[1] });
  const i = {
    ...registry(["0.1.0", "0.1.1"]),
    [names[1]]: { ...registry()[names[0]], name: names[1] },
  };
  const states = reconcile(r, i, artifacts());
  assert.deepEqual(
    states.map((item) => item.state),
    ["published", "absent"],
  );
  assert.deepEqual(
    remainingPlan(r, states, "resume").map((item) => item.name),
    [names[1]],
  );
});
invalid("resume registry divergence", () =>
  remainingPlan(
    record(),
    [{ name: names[0], version: "0.1.1", state: "divergent" }],
    "resume",
  ),
);
test("workspace policy and unauthorized version checks", () => {
  const manifests = names.map((name) => ({
    path: `packages/${name.split("/")[1]}`,
    pkg: {
      name,
      version: name === names[0] ? "0.1.1" : "0.1.0",
      license: "UNLICENSED",
      repository: "https://github.com/t00ls-dev/foundation",
      publishConfig: {
        registry: "https://npm.pkg.github.com",
        access: "restricted",
      },
      files: ["dist", "README.md"],
    },
  }));
  manifests.push({
    path: ".",
    pkg: { name: "@t00ls-dev/foundation", private: true },
  });
  validateManifests(manifests, record());
  manifests[0].pkg.version = "0.1.2";
  assert.throws(() => validateManifests(manifests, record()));
  manifests[0].pkg.version = "0.1.1";
  manifests.push({
    path: "tooling/config",
    pkg: { name: "@t00ls-dev/config-private" },
  });
  assert.throws(() => validateManifests(manifests, record()));
});

test("actual Changesets 3.0.3 pack-directory format works offline without publishing", () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-release-pack-test-"));
  try {
    const pkg = JSON.parse(
      readFileSync("packages/access/package.json", "utf8"),
    );
    const input = join(temp, "plan.json"),
      out = join(temp, "packed");
    writeFileSync(
      input,
      JSON.stringify({
        version: 1,
        plan: [
          [
            {
              kind: "publish",
              name: pkg.name,
              version: pkg.version,
              access: "restricted",
              tag: "latest",
            },
          ],
        ],
      }),
    );
    execFileSync(
      "pnpm",
      [
        "exec",
        "changeset",
        "pack",
        "--from-publish-plan",
        input,
        "--out-dir",
        out,
      ],
      { encoding: "utf8" },
    );
    const plan = JSON.parse(readFileSync(join(out, "publish-plan.json")));
    const entry = plan.plan.flat()[0];
    assert.equal(entry.name, pkg.name);
    assert.equal(entry.version, pkg.version);
    const bytes = readFileSync(join(out, entry.tarball.path));
    validateArtifactPath({ ...entry, path: entry.tarball.path });
    assert.equal(
      entry.tarball.path,
      `packages/t00ls-dev-access-${pkg.version}.tgz`,
    );
    const r = record();
    const [major, minor, patch] = pkg.version.split(".").map(BigInt);
    const previous =
      patch > 0n
        ? { oldVersion: `${major}.${minor}.${patch - 1n}`, type: "patch" }
        : minor > 0n
          ? { oldVersion: `${major}.${minor - 1n}.0`, type: "minor" }
          : { oldVersion: `${major - 1n}.0.0`, type: "major" };
    r.packages[0] = {
      ...r.packages[0],
      ...previous,
      version: pkg.version,
    };
    const p = packet();
    p.record = r;
    p.artifacts = [
      {
        name: entry.name,
        version: entry.version,
        path: entry.tarball.path,
        hash: hash(bytes),
        packIntegrity: entry.tarball.integrity,
        integrity: `sha512-${hash(bytes, "sha512", "base64")}`,
      },
    ];
    validatePacket(p, { ...context(), planDigest: envelopeDigest(p) }, r);
    assert.equal(
      entry.tarball.integrity,
      `sha256-${hash(bytes, "sha256", "base64")}`,
    );
    assert(entry.tarball.path.startsWith("packages/"));
    const help = execFileSync(
      "pnpm",
      ["exec", "changeset", "publish", "--help"],
      { encoding: "utf8" },
    );
    assert(help.includes("--from-pack-dir") && help.includes("--git-tag"));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("workflow cannot publish on push or audit; only publisher has packages:write", () => {
  const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, "audit");
  assert(!("expected_sha" in workflow.on.workflow_dispatch.inputs));
  assert.equal(workflow.on.workflow_dispatch.inputs.release_sha.required, true);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.execution_sha.required,
    true,
  );
  for (const name of ["audit", "preflight", "publish"]) {
    assert.equal(
      workflow.jobs[name].env.RELEASE_SHA,
      "${{ inputs.release_sha }}",
    );
    assert.equal(
      workflow.jobs[name].env.EXECUTION_SHA,
      "${{ inputs.execution_sha }}",
    );
    assert(!("EXPECTED_SHA" in workflow.jobs[name].env));
  }
  assert.equal(workflow.jobs.audit.permissions.packages, "read");
  assert.equal(workflow.jobs.preflight.permissions.packages, "read");
  assert.deepEqual(
    Object.entries(workflow.jobs)
      .filter(([, job]) => job.permissions?.packages === "write")
      .map(([name]) => name),
    ["publish"],
  );
  const condition = workflow.jobs.publish.if.replace(/\s+/g, " ");
  assert(
    condition.includes("github.event_name == 'workflow_dispatch'") &&
      condition.includes("github.ref == 'refs/heads/master'") &&
      condition.includes("needs.preflight.result == 'success'") &&
      condition.includes("inputs.mode == 'publish' || inputs.mode == 'resume'"),
  );
  assert(!ci.jobs.version.steps.some((step) => step.with?.["publish-script"]));
  assert(
    ci.jobs.version.steps.some(
      (step) =>
        step.with?.["version-script"] ===
        "node .github/scripts/release-version.mjs",
    ),
  );
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(ci.jobs.version.concurrency, workflow.concurrency);
  assert.equal(ci.jobs.version.needs, "checks");
  assert(ci.jobs.version.if.includes("github.event_name == 'push'"));
  assert(ci.jobs.version.if.includes("github.ref == 'refs/heads/master'"));
  assert.equal(ci.jobs.version.permissions.contents, "write");
  assert.equal(ci.jobs.version.permissions["pull-requests"], "write");
  assert(!("packages" in ci.jobs.version.permissions));
  assert.equal(ci.permissions.contents, "read");
  assert.equal(
    ci.jobs.checks.steps.filter((step) => step.run === "pnpm check").length,
    1,
  );
  for (const job of [ci.jobs.version, ...Object.values(workflow.jobs)]) {
    assert(
      !job.steps.some((step) =>
        /pnpm check|playwright install/.test(step.run ?? ""),
      ),
    );
  }
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.permissions.actions, "read");
  }
  assert(
    workflow.jobs.audit.steps.some(
      (step) => step.run === "pnpm --filter './packages/*' -r build",
    ),
  );
  assert(
    !workflow.jobs.preflight.steps.some((step) =>
      /\bbuild\b/.test(step.run ?? ""),
    ),
  );
  assert(workflow.jobs.publish.steps.some((step) => step.if === "always()"));
  const expression = condition.slice(3, -2).trim();
  const valid = {
    github: { event_name: "workflow_dispatch", ref: "refs/heads/master", sha },
    inputs: {
      mode: "publish",
      confirmation,
      execution_sha: sha,
      release_sha: sha,
    },
    needs: { preflight: { result: "success" } },
  };
  assert.equal(runInNewContext(expression, valid, { timeout: 1000 }), true);
  for (const candidate of [
    { ...valid, github: { ...valid.github, event_name: "push" } },
    { ...valid, github: { ...valid.github, ref: "refs/heads/feature" } },
    { ...valid, inputs: { ...valid.inputs, mode: "audit" } },
    { ...valid, inputs: { ...valid.inputs, confirmation: "wrong" } },
    { ...valid, inputs: { ...valid.inputs, execution_sha: "b".repeat(40) } },
    { ...valid, needs: { preflight: { result: "failure" } } },
    { ...valid, needs: { preflight: { result: "skipped" } } },
  ])
    assert.equal(
      runInNewContext(expression, candidate, { timeout: 1000 }),
      false,
    );
});

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

test("deploy validates trusted workflow code before exact-SHA checkout and limits secrets", () => {
  const workflow = parse(
    readFileSync(".github/workflows/deploy-dev.yml", "utf8"),
  );
  const job = workflow.jobs.deploy;
  const steps = job.steps;
  assert.equal(workflow.permissions.actions, "read");
  assert(job.if.includes("github.event.workflow_run.event == 'push'"));
  assert(
    job.if.includes(
      "github.event.workflow_run.head_repository.full_name == 't00ls-dev/foundation'",
    ),
  );
  assert(!job.env);
  assert.equal(steps[0].with.ref, "${{ github.sha }}");
  assert.equal(steps[1].run, "node .github/scripts/ci-evidence.mjs deploy");
  assert.equal(steps[2].with.ref, "${{ steps.ci.outputs.sha }}");
  for (const step of steps.filter((step) =>
    step.uses?.startsWith("actions/checkout@"),
  ))
    assert.equal(step.with["persist-credentials"], false);
  assert(
    !steps.some((step) => step.uses?.startsWith("actions/download-artifact@")),
  );
  for (const step of steps.filter((step) => step.env?.CLOUDFLARE_API_TOKEN))
    assert(["Apply DEV D1 migrations", "Deploy DEV"].includes(step.name));
});
