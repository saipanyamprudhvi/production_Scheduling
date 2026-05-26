const assert = require("assert");
const { loadDataset } = require("../src/storage");
const { runSchedule, getDemandQuantity, getRunMinutes } = require("../src/scheduler");

const dataset = loadDataset();
const scenario = dataset.scenarios[0];
const result = runSchedule({
  plant: dataset.plant,
  jobs: dataset.jobs,
  scenario
});

assert.strictEqual(result.assignments.length, dataset.jobs.length, "all jobs should be scheduled");
assert.ok(result.kpis.onTimeDeliveryRate >= 0, "on-time KPI should be calculated");
assert.ok(result.kpis.capacityUtilization > 0, "capacity utilization should be positive");

for (const assignment of result.assignments) {
  const job = dataset.jobs.find((item) => item.id === assignment.jobId);
  const line = dataset.plant.lines.find((item) => item.id === assignment.lineId);

  assert.ok(line.supportedFamilies.includes(job.family), `${job.id} assigned to incompatible line`);
  assert.strictEqual(assignment.quantity, getDemandQuantity(job), `${job.id} quantity should follow demand netting`);
  assert.strictEqual(assignment.runMinutes, getRunMinutes(job), `${job.id} run minutes should be deterministic`);
  assert.ok(new Date(assignment.end) > new Date(assignment.start), `${job.id} should have a positive duration`);
}

for (const line of dataset.plant.lines) {
  const lineAssignments = result.assignments
    .filter((assignment) => assignment.lineId === line.id)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  for (let index = 1; index < lineAssignments.length; index += 1) {
    assert.ok(
      new Date(lineAssignments[index].start) >= new Date(lineAssignments[index - 1].end),
      `${line.id} should not have overlapping assignments`
    );
  }
}

console.log("Scheduler tests passed");
