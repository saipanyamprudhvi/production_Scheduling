const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadDataset, readJson, writeJson } = require("./src/storage");
const { runSchedule } = require("./src/scheduler");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const RUN_CACHE = new Map();

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text, contentType = "text/plain") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function getScenarioOrFail(id) {
  const scenarios = readJson("scenarios.json");
  const scenario = scenarios.find((item) => item.id === id);
  return { scenarios, scenario };
}

function runScenario(id) {
  const dataset = loadDataset();
  const scenario = dataset.scenarios.find((item) => item.id === id);
  if (!scenario) return null;

  const result = runSchedule({
    plant: dataset.plant,
    jobs: dataset.jobs,
    scenario
  });
  RUN_CACHE.set(id, result);
  return result;
}

function toCsv(result) {
  const header = [
    "jobId",
    "customer",
    "partNumber",
    "family",
    "lineName",
    "start",
    "end",
    "quantity",
    "runMinutes",
    "changeoverMinutes",
    "dueDate",
    "priority"
  ];
  const rows = result.assignments.map((job) =>
    header.map((field) => `"${String(job[field] ?? "").replace(/"/g, '""')}"`).join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) return notFound(res);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return notFound(res);

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml"
  };
  sendText(res, 200, fs.readFileSync(filePath), contentTypes[ext] || "application/octet-stream");
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const dataset = loadDataset();
    const latestResult = RUN_CACHE.get("SCN-BASE") || runScenario("SCN-BASE");
    return sendJson(res, 200, { ...dataset, latestResult });
  }

  if (req.method === "GET" && url.pathname === "/api/scenarios") {
    return sendJson(res, 200, readJson("scenarios.json"));
  }

  if (req.method === "POST" && url.pathname === "/api/scenarios") {
    const body = await parseBody(req);
    const scenarios = readJson("scenarios.json");
    const id = `SCN-${Date.now().toString(36).toUpperCase()}`;
    const scenario = {
      id,
      name: body.name || "New Scenario",
      status: "draft",
      createdAt: new Date().toISOString(),
      weights: body.weights || { dueDate: 45, changeover: 25, utilization: 20, inventory: 10 },
      lockedJobs: body.lockedJobs || [],
      overrides: body.overrides || {},
      notes: body.notes || ""
    };
    scenarios.unshift(scenario);
    writeJson("scenarios.json", scenarios);
    return sendJson(res, 201, scenario);
  }

  const runMatch = url.pathname.match(/^\/api\/scenarios\/([^/]+)\/run$/);
  if (req.method === "POST" && runMatch) {
    const result = runScenario(runMatch[1]);
    if (!result) return notFound(res);
    return sendJson(res, 200, result);
  }

  const approveMatch = url.pathname.match(/^\/api\/scenarios\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const { scenarios, scenario } = getScenarioOrFail(approveMatch[1]);
    if (!scenario) return notFound(res);
    scenarios.forEach((item) => {
      item.status = item.id === scenario.id ? "approved" : item.status === "approved" ? "archived" : item.status;
    });
    writeJson("scenarios.json", scenarios);
    return sendJson(res, 200, { ok: true, scenarioId: scenario.id });
  }

  if (req.method === "POST" && url.pathname === "/api/feedback") {
    const body = await parseBody(req);
    const feedback = readJson("feedback.json");
    const record = {
      id: `FDB-${Date.now().toString(36).toUpperCase()}`,
      scenarioId: body.scenarioId,
      jobId: body.jobId,
      type: body.type || "planner",
      message: body.message || "",
      impact: body.impact || "general",
      createdAt: new Date().toISOString()
    };
    feedback.unshift(record);
    writeJson("feedback.json", feedback);
    return sendJson(res, 201, record);
  }

  const exportMatch = url.pathname.match(/^\/api\/scenarios\/([^/]+)\/export.csv$/);
  if (req.method === "GET" && exportMatch) {
    const result = RUN_CACHE.get(exportMatch[1]) || runScenario(exportMatch[1]);
    if (!result) return notFound(res);
    res.writeHead(200, {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${exportMatch[1]}-schedule.csv"`
    });
    return res.end(toCsv(result));
  }

  return notFound(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`PRISM Production Scheduling running at http://localhost:${PORT}`);
  });
}

module.exports = { server, runScenario };
