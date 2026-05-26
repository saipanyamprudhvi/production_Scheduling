const state = {
  plant: null,
  jobs: [],
  scenarios: [],
  feedback: [],
  result: null,
  activeScenarioId: "SCN-BASE"
};

if (window.location.protocol === "file:") {
  document.querySelector("#generatedAt").textContent =
    "This project must be run through the local server. Double-click START-HERE.bat, then open http://localhost:3001.";
  throw new Error("Open the app through http://localhost:3001 instead of public/index.html");
}

const els = {
  scenarioSelect: document.querySelector("#scenarioSelect"),
  scenarioName: document.querySelector("#scenarioName"),
  weightDue: document.querySelector("#weightDue"),
  weightChangeover: document.querySelector("#weightChangeover"),
  weightUtilization: document.querySelector("#weightUtilization"),
  weightInventory: document.querySelector("#weightInventory"),
  createScenarioBtn: document.querySelector("#createScenarioBtn"),
  runScenarioBtn: document.querySelector("#runScenarioBtn"),
  approveScenarioBtn: document.querySelector("#approveScenarioBtn"),
  exportLink: document.querySelector("#exportLink"),
  kpiGrid: document.querySelector("#kpiGrid"),
  generatedAt: document.querySelector("#generatedAt"),
  scheduleBoard: document.querySelector("#scheduleBoard"),
  bottlenecks: document.querySelector("#bottlenecks"),
  explainability: document.querySelector("#explainability"),
  feedbackList: document.querySelector("#feedbackList"),
  feedbackJob: document.querySelector("#feedbackJob"),
  feedbackImpact: document.querySelector("#feedbackImpact"),
  feedbackMessage: document.querySelector("#feedbackMessage"),
  submitFeedbackBtn: document.querySelector("#submitFeedbackBtn"),
  toast: document.querySelector("#toast")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || response.statusText);
  }
  return response.json();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function familyClass(family) {
  return family.toLowerCase();
}

function activeScenario() {
  return state.scenarios.find((scenario) => scenario.id === state.activeScenarioId) || state.scenarios[0];
}

function renderScenarios() {
  els.scenarioSelect.innerHTML = state.scenarios
    .map((scenario) => `<option value="${scenario.id}">${scenario.name} (${scenario.status})</option>`)
    .join("");
  els.scenarioSelect.value = state.activeScenarioId;
  els.exportLink.href = `/api/scenarios/${state.activeScenarioId}/export.csv`;
}

function renderFeedbackJobs() {
  els.feedbackJob.innerHTML = state.jobs
    .map((job) => `<option value="${job.id}">${job.id} - ${job.partNumber}</option>`)
    .join("");
}

function renderKpis(result) {
  const kpis = result.kpis;
  const items = [
    ["Optimization model", result.model || "CP-SAT"],
    ["On-time delivery", `${kpis.onTimeDeliveryRate}%`],
    ["Adherence projection", `${kpis.scheduleAdherenceProjection}%`],
    ["Capacity utilization", `${kpis.capacityUtilization}%`],
    ["Changeover hours", kpis.changeoverHours],
    ["Solver status", kpis.solverStatus || "Solved"]
  ];
  els.kpiGrid.innerHTML = items
    .map(([label, value]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderSchedule(result) {
  const calendar = state.plant.calendar.map((day) => day.date);
  const byLine = result.assignments.reduce((groups, job) => {
    groups[job.lineId] = groups[job.lineId] || [];
    groups[job.lineId].push(job);
    return groups;
  }, {});

  els.scheduleBoard.innerHTML = state.plant.lines
    .map((line) => {
      const jobs = byLine[line.id] || [];
      const cells = calendar
        .map((date) => {
          const dayJobs = jobs.filter((job) => job.start.slice(0, 10) === date);
          const pills = dayJobs
            .map(
              (job) => `
                <div class="job-pill ${familyClass(job.family)}" title="${job.explanation.join(" ")}">
                  <strong>${job.jobId}</strong>
                  <span>${formatDateTime(job.start)} - ${formatDateTime(job.end)}</span>
                  <span>${job.quantity} units | ${job.changeoverMinutes}m setup</span>
                </div>
              `
            )
            .join("");
          return `<div class="day-cell"><time>${date.slice(5)}</time>${pills}</div>`;
        })
        .join("");
      return `<div class="line-row"><div class="line-label">${line.name}</div><div class="line-track">${cells}</div></div>`;
    })
    .join("");
}

function renderBottlenecks(result) {
  els.bottlenecks.innerHTML = result.kpis.utilizationByLine
    .map(
      (line) => `
        <div class="list-item">
          <strong>${line.lineName}</strong>
          <p>${line.usedMinutes} of ${line.capacityMinutes} minutes planned</p>
          <div class="meter"><span style="width:${Math.min(line.utilization, 100)}%"></span></div>
        </div>
      `
    )
    .join("");
}

function renderExplainability(result) {
  const topJobs = result.assignments.slice(0, 5);
  els.explainability.innerHTML = topJobs
    .map(
      (job) => `
        <div class="list-item">
          <strong>${job.jobId} on ${job.lineName}</strong>
          <p>${job.explanation.join(" ")}</p>
        </div>
      `
    )
    .join("");
}

function renderFeedback() {
  els.feedbackList.innerHTML = state.feedback
    .slice(0, 6)
    .map(
      (item) => `
        <div class="list-item">
          <strong>${item.jobId || "General"} | ${item.impact}</strong>
          <p>${item.message}</p>
        </div>
      `
    )
    .join("");
}

function renderResult() {
  if (!state.result) return;
  renderKpis(state.result);
  renderSchedule(state.result);
  renderBottlenecks(state.result);
  renderExplainability(state.result);
  els.generatedAt.textContent = `Generated ${formatDateTime(state.result.generatedAt)}`;
}

function applyScenarioControls(scenario) {
  if (!scenario) return;
  els.weightDue.value = scenario.weights.dueDate;
  els.weightChangeover.value = scenario.weights.changeover;
  els.weightUtilization.value = scenario.weights.utilization;
  els.weightInventory.value = scenario.weights.inventory;
}

async function loadDashboard() {
  const dashboard = await api("/api/dashboard");
  state.plant = dashboard.plant;
  state.jobs = dashboard.jobs;
  state.scenarios = dashboard.scenarios;
  state.feedback = dashboard.feedback;
  state.result = dashboard.latestResult;
  state.activeScenarioId = dashboard.latestResult.scenarioId;
  renderScenarios();
  renderFeedbackJobs();
  renderFeedback();
  applyScenarioControls(activeScenario());
  renderResult();
}

async function createScenario() {
  const scenario = await api("/api/scenarios", {
    method: "POST",
    body: JSON.stringify({
      name: els.scenarioName.value.trim() || "Planner what-if",
      weights: {
        dueDate: Number(els.weightDue.value),
        changeover: Number(els.weightChangeover.value),
        utilization: Number(els.weightUtilization.value),
        inventory: Number(els.weightInventory.value)
      },
      notes: "Created from planner workbench."
    })
  });
  state.scenarios.unshift(scenario);
  state.activeScenarioId = scenario.id;
  renderScenarios();
  showToast("Scenario created");
}

async function runActiveScenario() {
  const result = await api(`/api/scenarios/${state.activeScenarioId}/run`, { method: "POST" });
  state.result = result;
  renderResult();
  els.exportLink.href = `/api/scenarios/${state.activeScenarioId}/export.csv`;
  showToast("Scenario solved");
}

async function approveActiveScenario() {
  await api(`/api/scenarios/${state.activeScenarioId}/approve`, { method: "POST" });
  state.scenarios = await api("/api/scenarios");
  renderScenarios();
  showToast("Plan approved for publishing");
}

async function submitFeedback() {
  const message = els.feedbackMessage.value.trim();
  if (!message) {
    showToast("Add feedback text first");
    return;
  }

  const record = await api("/api/feedback", {
    method: "POST",
    body: JSON.stringify({
      scenarioId: state.activeScenarioId,
      jobId: els.feedbackJob.value,
      impact: els.feedbackImpact.value,
      message
    })
  });
  state.feedback.unshift(record);
  els.feedbackMessage.value = "";
  renderFeedback();
  showToast("Feedback captured");
}

els.scenarioSelect.addEventListener("change", () => {
  state.activeScenarioId = els.scenarioSelect.value;
  applyScenarioControls(activeScenario());
  els.exportLink.href = `/api/scenarios/${state.activeScenarioId}/export.csv`;
});
els.createScenarioBtn.addEventListener("click", createScenario);
els.runScenarioBtn.addEventListener("click", runActiveScenario);
els.approveScenarioBtn.addEventListener("click", approveActiveScenario);
els.submitFeedbackBtn.addEventListener("click", submitFeedback);

loadDashboard().catch((error) => {
  console.error(error);
  showToast(error.message);
});
