import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  authenticatedJson,
  canonical,
  digest,
  envelopeDigest,
  hash,
  names,
  reconcile,
  registry,
  registryInventory,
  remainingPlan,
  repository,
  validateContext,
  validateManifests,
  validatePacket,
  validatePr,
  validatePublishPlan,
  validateArtifactPath,
  validateReleaseCommit,
  validateRecordPlan,
  validateProtectedInputs,
  validateAuditRun,
} from "./release-core.mjs";
import {
  recordFromBase,
  contentBinding,
  treeAtCommit,
} from "./release-planning.mjs";
import { approvedCi } from "./ci-evidence.mjs";

const require = createRequire(import.meta.url);
const recordPath = ".changeset/release-plan.json";
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (path, value) => writeFileSync(path, canonical(value) + "\n");
const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8" });
const gh = `https://api.github.com/repos/${repository}`;

async function request(url, token = process.env.GITHUB_TOKEN) {
  return authenticatedJson(url, token);
}

async function pages(url, collection) {
  const result = [];
  for (let page = 1; ; page++) {
    const response = await request(
      `${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const data = collection ? response[collection] : response;
    assert(Array.isArray(data));
    result.push(...data);
    if (data.length < 100) return result;
  }
}

async function content(path, ref) {
  const file = await request(`${gh}/contents/${path}?ref=${ref}`);
  assert.equal(file.encoding, "base64");
  return Buffer.from(file.content, "base64");
}

async function context() {
  const repo = await request(gh);
  assert(
    repo.private && repo.default_branch === "master",
    "Repository must remain private with master base",
  );
  const master = await request(`${gh}/git/ref/heads/master`);
  const value = {
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    releaseSha: process.env.RELEASE_SHA,
    executionSha: process.env.EXECUTION_SHA,
    legacyExpectedSha:
      process.env.EXPECTED_SHA ??
      (process.env.GITHUB_EVENT_PATH
        ? json(process.env.GITHUB_EVENT_PATH).inputs?.expected_sha
        : undefined),
    masterSha: master.object.sha,
    mode: process.env.RELEASE_MODE,
    releasePr: Number(process.env.RELEASE_PR),
    confirmation: process.env.RELEASE_CONFIRMATION,
    planDigest: process.env.PLAN_DIGEST,
    auditRun: Number(process.env.AUDIT_RUN),
  };
  validateContext(value, value.mode !== "audit");
  assert.equal(
    run("git", ["rev-parse", "HEAD"]).trim(),
    value.executionSha,
    "Checkout must match authorized execution SHA",
  );
  await approvedCi(value.executionSha);
  assert.equal(
    (await request(`${gh}/git/ref/heads/master`)).object.sha,
    value.executionSha,
    "Master advanced while validating CI evidence",
  );
  return value;
}

async function provenance(value) {
  assert(existsSync(recordPath), "Merged Version Packages record missing");
  const record = jsonFrom(await content(recordPath, value.releaseSha));
  assert.deepEqual(
    json(recordPath),
    record,
    "Checkout release record differs from release_sha",
  );
  const pr = await request(`${gh}/pulls/${value.releasePr}`);
  validatePr(pr, value, record);
  assert.deepEqual(
    jsonFrom(await content(recordPath, pr.head.sha)),
    record,
    "Record not reviewed in PR head",
  );
  const files = await pages(`${gh}/pulls/${value.releasePr}/files`);
  const allowed = new Set([
    recordPath,
    "pnpm-lock.yaml",
    ...record.changesets.map((item) => `.changeset/${item.id}.md`),
    ...record.packages.flatMap((item) => [
      `packages/${item.name.split("/")[1]}/package.json`,
      `packages/${item.name.split("/")[1]}/CHANGELOG.md`,
    ]),
  ]);
  assert(
    files.every((file) => allowed.has(file.filename)),
    "Release PR contains unrelated changes",
  );
  assert(
    files.some((file) => file.filename === recordPath),
    "Release record was not generated in this PR",
  );
  for (const item of record.changesets) {
    assert(
      files.some(
        (file) =>
          file.filename === `.changeset/${item.id}.md` &&
          file.status === "removed",
      ),
      "Changeset not consumed in Release PR",
    );
    assert.equal(
      hash(await content(`.changeset/${item.id}.md`, record.baseSha)),
      item.hash,
      "Consumed changeset hash mismatch",
    );
  }
  const commits = await pages(`${gh}/pulls/${value.releasePr}/commits`);
  validateReleaseCommit(commits, pr, record);
  const binding = await contentBinding(
    value.releaseSha,
    value.executionSha,
    request,
  );
  validateProtectedInputs(
    await treeAtCommit(pr.head.sha, request),
    binding.releaseTree,
  );
  const tree = await request(`${gh}/git/trees/${record.baseSha}?recursive=1`);
  validateRecordPlan(
    record,
    await recordFromBase({
      baseSha: record.baseSha,
      cliVersion: record.cliVersion,
      tree,
      content,
    }),
  );
  for (const item of record.packages) {
    const path = `packages/${item.name.split("/")[1]}/package.json`;
    const before = jsonFrom(await content(path, record.baseSha)),
      after = jsonFrom(await content(path, pr.head.sha));
    assert.equal(before.version, item.oldVersion);
    assert.equal(after.version, item.version);
    assert(files.some((file) => file.filename === path));
    assert(
      files.some(
        (file) =>
          file.filename === `packages/${item.name.split("/")[1]}/CHANGELOG.md`,
      ),
    );
  }
  return { record, protectedInputsDigest: binding.protectedInputsDigest };
}
const jsonFrom = (buffer) => JSON.parse(buffer.toString());

function manifests() {
  const result = [{ path: ".", pkg: json("package.json") }];
  // Reject changed workspace globs rather than overlooking a new publishable directory.
  assert.equal(
    readFileSync("pnpm-workspace.yaml", "utf8").split("\n\n")[0],
    "packages:\n  - packages/*\n  - tooling/*\n  - examples/*\n  - tests/*",
  );
  for (const group of ["packages", "tooling", "examples", "tests"]) {
    for (const dir of readdirSync(group, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory(),
    )) {
      const path = `${group}/${dir.name}`;
      if (existsSync(`${path}/package.json`))
        result.push({ path, pkg: json(`${path}/package.json`) });
    }
  }
  return result;
}

function sourceGates(record) {
  assert.equal(
    require("@changesets/cli/package.json").version,
    record.cliVersion,
  );
  validateManifests(manifests(), record);
  assert(
    !readdirSync(".changeset").some(
      (file) => file.endsWith(".md") && file !== "README.md",
    ),
    "Active changesets after Release PR merge",
  );
  assert(
    !existsSync(".changeset/pre.json"),
    "Prereleases are not supported by this workflow",
  );
  assert.equal(
    run("git", ["status", "--porcelain", "--untracked-files=normal"]).trim(),
    "",
    "Tracked workspace must be frozen",
  );
}

async function inventory() {
  return registryInventory(process.env.NODE_AUTH_TOKEN);
}

function unchangedPackages(record, state) {
  for (const { pkg } of manifests().filter(({ pkg }) =>
    names.includes(pkg.name),
  )) {
    if (record.packages.some((item) => item.name === pkg.name)) continue;
    assert(
      state[pkg.name]?.name === pkg.name &&
        state[pkg.name].latest === pkg.version &&
        state[pkg.name].versions.includes(pkg.version),
      `Unplanned local/registry version: ${pkg.name}`,
    );
  }
}

function inspect(directory, item) {
  const path = join(directory, item.path);
  assert.equal(hash(readFileSync(path)), item.hash, "Artifact bytes changed");
  assert.equal(
    `sha512-${hash(readFileSync(path), "sha512", "base64")}`,
    item.integrity,
  );
  assert.equal(
    `sha256-${hash(readFileSync(path), "sha256", "base64")}`,
    item.packIntegrity,
  );
  const list = run("tar", ["-tzf", path])
    .trim()
    .split("\n")
    .map((file) => file.replace(/^package\//, ""));
  assert(
    !run("tar", ["-tvzf", path])
      .split("\n")
      .some((line) => /^[lh]/.test(line)),
    "Artifact links forbidden",
  );
  const pkg = jsonFrom(
    Buffer.from(run("tar", ["-xOzf", path, "package/package.json"])),
  );
  assert.equal(pkg.name, item.name);
  assert.equal(pkg.version, item.version);
  assert.equal(pkg.license, "UNLICENSED");
  assert(!pkg.private);
  assert.equal(pkg.repository, "https://github.com/t00ls-dev/foundation");
  assert.equal(pkg.publishConfig?.registry, registry);
  assert.equal(pkg.publishConfig?.access, "restricted");
  assert(pkg.exports && Object.keys(pkg.exports).length);
  for (const field of [
    "dependencies",
    "optionalDependencies",
    "devDependencies",
    "peerDependencies",
  ]) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      assert(
        !name.startsWith("@t00ls-dev/") || names.includes(name),
        "Private tooling in artifact",
      );
      assert(
        !/^(workspace:|file:|link:)/.test(range),
        "Local dependency in artifact",
      );
    }
  }
  for (const entry of Object.values(pkg.exports))
    assert(
      list.includes(entry.types?.slice(2)) &&
        list.includes(entry.default?.slice(2)),
      "Missing exported files",
    );
  for (const file of list) {
    assert(
      /^(dist\/.*\.(js|d\.ts)|README\.md|CHANGELOG\.md|package\.json)$/.test(
        file,
      ),
      `Unexpected artifact file: ${file}`,
    );
    if (file.endsWith(".d.ts"))
      assert(
        !run("tar", ["-xOzf", path, `package/${file}`]).includes(
          "sourceMappingURL",
        ),
        "Broken declaration map reference",
      );
  }
}

function packPlan(plan, artifacts) {
  return {
    version: 1,
    plan: plan.plan.map((chunk) =>
      chunk.map((item) => {
        const artifact = artifacts.find(
          (entry) => entry.name === item.name && entry.version === item.version,
        );
        assert(artifact, "Missing approved artifact");
        return {
          ...item,
          tarball: { path: artifact.path, integrity: artifact.packIntegrity },
        };
      }),
    ),
  };
}

function changesetsPlan(directory, approved) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "registry-plan.json");
  run("pnpm", ["exec", "changeset", "publish-plan", "--output", path]);
  const plan = json(path);
  validatePublishPlan(plan, approved);
  return { plan, path };
}

function summarize(value, packet, states) {
  const report = {
    releasePr: value.releasePr,
    releaseSha: value.releaseSha,
    executionSha: value.executionSha,
    protectedInputsDigest: packet.protectedInputsDigest,
    mode: value.mode,
    planDigest: envelopeDigest(packet),
    auditRun: packet.auditRun,
    states,
    artifacts: packet.artifacts,
  };
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "\n## Private Foundation release\n```json\n" +
        JSON.stringify(report, null, 2) +
        "\n```\n",
      { flag: "a" },
    );
  if (process.env.GITHUB_OUTPUT)
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `plan_digest=${report.planDigest}\n`,
      { flag: "a" },
    );
}

async function prepare(directory) {
  const value = await context();
  const { record, protectedInputsDigest } = await provenance(value);
  value.protectedInputsDigest = protectedInputsDigest;
  sourceGates(record);
  const current = await inventory();
  unchangedPackages(record, current);
  let packet;
  if (value.mode === "audit") {
    const approved = remainingPlan(record, reconcile(record, current), "audit");
    const { path: planPath } = changesetsPlan(directory, approved);
    run("pnpm", [
      "exec",
      "changeset",
      "pack",
      "--from-publish-plan",
      planPath,
      "--out-dir",
      join(directory, "packed"),
    ]);
    const packed = json(join(directory, "packed/publish-plan.json"));
    const items = packed.plan.flat();
    assert.equal(items.length, record.packages.length);
    const artifacts = items
      .map((item) => {
        assert(
          record.packages.some(
            (approved) =>
              approved.name === item.name && approved.version === item.version,
          ),
        );
        const path = item.tarball.path;
        validateArtifactPath({ name: item.name, version: item.version, path });
        const bytes = readFileSync(join(directory, "packed", path));
        assert.equal(
          item.tarball.integrity,
          `sha256-${hash(bytes, "sha256", "base64")}`,
        );
        return {
          name: item.name,
          version: item.version,
          path,
          hash: hash(bytes),
          packIntegrity: item.tarball.integrity,
          integrity: `sha512-${hash(bytes, "sha512", "base64")}`,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    packet = {
      format: 2,
      repository,
      releasePr: value.releasePr,
      releaseSha: value.releaseSha,
      executionSha: value.executionSha,
      protectedInputsDigest,
      record,
      auditRun: Number(process.env.GITHUB_RUN_ID),
      artifacts,
    };
    write(join(directory, "authorization.json"), packet);
  } else {
    packet = json(join(directory, "authorization.json"));
    const audit = await request(`${gh}/actions/runs/${value.auditRun}`);
    const workflow = await request(`${gh}/actions/workflows/release.yml`);
    const jobs = await pages(
      `${gh}/actions/runs/${value.auditRun}/jobs?filter=latest`,
      "jobs",
    );
    validateAuditRun(audit, jobs, workflow.id, value);
    validatePacket(packet, value, record);
  }
  for (const item of packet.artifacts) inspect(join(directory, "packed"), item);
  const fresh = await inventory();
  unchangedPackages(record, fresh);
  const states = reconcile(record, fresh, packet.artifacts);
  const remaining = remainingPlan(record, states, value.mode);
  const computed = changesetsPlan(directory, remaining).plan;
  sourceGates(record);
  await context();
  summarize(value, packet, states);
  return { value, record, packet, states, computed };
}

async function publish(directory) {
  const initial = await context();
  assert(
    ["publish", "resume"].includes(initial.mode),
    "Audit cannot call publisher",
  );
  const { value, record, packet } = await prepare(directory);
  assert(
    ["publish", "resume"].includes(value.mode),
    "Audit cannot call publisher",
  );
  const latest = await inventory();
  unchangedPackages(record, latest);
  const remaining = remainingPlan(
    record,
    reconcile(record, latest, packet.artifacts),
    value.mode,
  );
  const computed = changesetsPlan(directory, remaining).plan;
  // This exact validated pack directory is consumed; no re-packing or automatic
  // retry. A new remaining plan never includes an already-confirmed version.
  write(
    join(directory, "packed/publish-plan.json"),
    packPlan(computed, packet.artifacts),
  );
  sourceGates(record);
  await context();
  let exitCode = 0;
  if (remaining.length)
    exitCode =
      spawnSync(
        "pnpm",
        [
          "exec",
          "changeset",
          "publish",
          "--from-pack-dir",
          join(directory, "packed"),
          "--no-git-tag",
        ],
        { stdio: "inherit" },
      ).status ?? 1;
  // Always reconcile after an attempted publish, even when only some succeeded.
  let final;
  try {
    final = reconcile(record, await inventory(), packet.artifacts);
    await context();
  } catch (error) {
    final = record.packages.map((item) => ({
      name: item.name,
      version: item.version,
      state: "divergent",
      reason:
        "Post-publication registry/execution verification failed; state unverified",
    }));
    write(join(directory, "reconciliation.json"), {
      exitCode,
      states: final,
      error: error.message,
    });
    summarize(value, packet, final);
    throw error;
  }
  write(join(directory, "reconciliation.json"), { exitCode, states: final });
  summarize(value, packet, final);
  assert(
    exitCode === 0 && final.every((item) => item.state === "published"),
    "Partial/failed/divergent release; review report before explicit resume",
  );
}

try {
  const [command, path] = process.argv.slice(2);
  if (command === "context") {
    const value = await context();
    await provenance(value);
  } else if (command === "prepare") await prepare(resolve(path));
  else if (command === "publish") await publish(resolve(path));
  else throw new Error("Expected context, prepare or publish");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
