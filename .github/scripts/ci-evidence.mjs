import assert from "node:assert/strict";
import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { authenticatedJson, repository, shaPattern } from "./release-core.mjs";

const workflowPath = ".github/workflows/ci.yml";
const api = `https://api.github.com/repos/${repository}`;

export function validateCiRun(run, jobs, workflow, sha) {
  assert(shaPattern.test(sha), "Invalid CI SHA");
  assert.equal(workflow.path, workflowPath, "Unexpected CI workflow path");
  assert(Number.isSafeInteger(workflow.id) && workflow.id > 0);
  assert.equal(run.workflow_id, workflow.id, "Unexpected CI workflow identity");
  assert.equal(run.path, workflowPath);
  assert.equal(
    run.repository?.full_name,
    repository,
    "Unexpected CI repository",
  );
  assert.equal(
    run.head_repository?.full_name,
    repository,
    "Untrusted CI origin",
  );
  assert.equal(run.event, "push", "Only master push CI is trusted");
  assert.equal(run.head_branch, "master");
  assert.equal(run.head_sha, sha, "CI SHA differs from execution SHA");
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert(Number.isSafeInteger(run.id) && run.id > 0);
  assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  assert(Array.isArray(jobs));
  const checks = jobs.filter((job) => job.name === "checks");
  assert.equal(checks.length, 1, "Exactly one CI checks job required");
  const job = checks[0];
  assert.equal(job.run_id, run.id);
  assert.equal(job.run_attempt, run.run_attempt, "Different CI attempt");
  assert.equal(job.head_sha, sha);
  assert.equal(job.status, "completed");
  assert.equal(job.conclusion, "success", "CI checks did not succeed");
  return { runId: run.id, attempt: run.run_attempt, sha };
}

export function validateDeployEvent(event) {
  assert.equal(event.repository?.full_name, repository);
  const run = event.workflow_run;
  assert(run, "Missing workflow_run origin");
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.event, "push");
  assert.equal(run.head_branch, "master");
  assert(shaPattern.test(run.head_sha));
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert(Number.isSafeInteger(run.id) && run.id > 0);
  assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  return run;
}

export async function approvedCi(sha, { request, origin } = {}) {
  assert(shaPattern.test(sha));
  request ??= (url) => authenticatedJson(url, process.env.GITHUB_TOKEN);
  const workflow = await request(`${api}/actions/workflows/ci.yml`);
  assert.equal(workflow.path, workflowPath);
  assert(Number.isSafeInteger(workflow.id) && workflow.id > 0);
  const runsUrl = `${api}/actions/workflows/${workflow.id}/runs?head_sha=${sha}&event=push&branch=master&per_page=100`;
  let id = origin?.id;
  if (!origin) {
    // Do not fall back to an older green run when the newest run is invalid.
    const result = await request(runsUrl);
    assert(Array.isArray(result.workflow_runs));
    assert(result.workflow_runs.length > 0, "No CI evidence for execution SHA");
    id = result.workflow_runs[0].id;
  }
  assert(Number.isSafeInteger(id) && id > 0);
  const run = await request(`${api}/actions/runs/${id}`);
  assert.equal(run.id, id);
  if (origin) {
    assert.equal(run.id, origin.id);
    assert.equal(
      run.run_attempt,
      origin.run_attempt,
      "Stale deploy CI attempt",
    );
    assert.equal(run.workflow_id, origin.workflow_id);
  }
  assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  const jobs = [];
  for (let page = 1; ; page++) {
    const result = await request(
      `${api}/actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
    );
    assert(Array.isArray(result.jobs));
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) break;
  }
  const evidence = validateCiRun(run, jobs, workflow, sha);
  // Fail closed if a rerun invalidated the result while jobs were retrieved.
  const current = await request(`${api}/actions/runs/${id}`);
  assert.equal(current.id, id);
  validateCiRun(current, jobs, workflow, sha);
  if (!origin) {
    const latest = await request(runsUrl);
    assert(Array.isArray(latest.workflow_runs));
    assert.equal(
      latest.workflow_runs[0]?.id,
      id,
      "New CI run; revalidate evidence",
    );
  }
  console.log(
    `Approved master CI: run ${evidence.runId}, attempt ${evidence.attempt}, SHA ${sha}`,
  );
  return evidence;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.equal(process.argv[2], "deploy");
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_run");
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  const origin = validateDeployEvent(
    JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
  );
  const evidence = await approvedCi(origin.head_sha, { origin });
  appendFileSync(process.env.GITHUB_OUTPUT, `sha=${evidence.sha}\n`);
}
