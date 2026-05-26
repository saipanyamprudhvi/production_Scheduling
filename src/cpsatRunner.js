const path = require("path");
const { spawnSync } = require("child_process");

function getPythonExecutable() {
  const configured = process.env.PYTHON_EXE;
  if (configured) return configured;

  if (process.env.USERPROFILE) {
    return path.join(
      process.env.USERPROFILE,
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "python",
      "python.exe"
    );
  }

  return "python";
}

function runCpSatSchedule({ plant, jobs, scenario }) {
  const script = path.join(__dirname, "cp_sat_scheduler.py");
  const pythonExe = getPythonExecutable();
  const child = spawnSync(pythonExe, [script], {
    input: JSON.stringify({ plant, jobs, scenario }),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });

  if (child.error) {
    throw new Error(`Unable to start CP-SAT solver: ${child.error.message}`);
  }

  if (child.status !== 0) {
    throw new Error(`CP-SAT solver failed: ${child.stderr || child.stdout}`);
  }

  try {
    return JSON.parse(child.stdout);
  } catch (error) {
    throw new Error(`CP-SAT solver returned invalid JSON: ${error.message}`);
  }
}

module.exports = { runCpSatSchedule, getPythonExecutable };
