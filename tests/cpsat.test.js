const assert = require("assert");
const { loadDataset } = require("../src/storage");
const { runSchedule } = require("../src/scheduler");

const dataset = loadDataset();
const result = runSchedule({
  plant: dataset.plant,
  jobs: dataset.jobs,
  scenario: dataset.scenarios[0]
});

assert.strictEqual(result.model, "Google OR-Tools CP-SAT", "CP-SAT model should be used");
assert.strictEqual(result.assignments.length, dataset.jobs.length, "all jobs should be scheduled");
assert.ok(result.kpis.solverStatus === "OPTIMAL" || result.kpis.solverStatus === "FEASIBLE", "solver should be feasible");

for (const assignment of result.assignments) {
  const line = dataset.plant.lines.find((item) => item.id === assignment.lineId);
  const job = dataset.jobs.find((item) => item.id === assignment.jobId);
  assert.ok(line.supportedFamilies.includes(job.family), `${job.id} assigned to incompatible line`);
  assert.ok(new Date(assignment.end) > new Date(assignment.start), `${job.id} must have positive duration`);
}

console.log("CP-SAT scheduler tests passed");
