# PRISM Production Scheduling

End-to-end local production scheduling optimizer and planner workbench based on the requirement document.

## What You Get

- Local Python API and browser UI.
- Seeded manufacturing data for plant lines, capacity calendar, demand, inventory, lots, and scenarios.
- Google OR-Tools CP-SAT scheduling model with capacity, due date, line compatibility, changeover, inventory, and lot-size logic.
- Planner workbench with KPI cards, line/day schedule, bottlenecks, explainability, what-if weights, approval, feedback capture, and CSV export.
- Automated scheduler regression test.

## Run Locally

Use Python 3.10 or newer. OR-Tools is installed locally under `vendor/python`.

On Windows, the easiest option is:

```text
Double-click START-HERE.bat
```

Then open:

```text
http://localhost:3001
```

Do not open `public/index.html` directly. The app needs the local API server for data, scenarios, feedback, and exports.

Manual option:

```bash
npm test
python tests/cpsat_python_test.py
python app_server.py
```

Open:

```text
http://localhost:3001
```

## Project Structure

```text
data/                 Seed data and persisted local scenarios/feedback
docs/                 Architecture and handoff notes
public/               Browser UI
src/                  CP-SAT model, storage, and legacy Node helpers
tests/                Regression tests
app_server.py         Local Python API/static server
server.js             Legacy Node API/static server
package.json          Run scripts
```

## Planner Workflow

1. Open the app.
2. Review baseline KPIs and schedule.
3. Adjust scenario weights.
4. Create a what-if scenario.
5. Run the scenario.
6. Review bottlenecks and explanations.
7. Submit planner or execution feedback.
8. Approve the plan.
9. Export CSV for shop-floor publishing.

## Notes

This is a runnable pilot implementation using Google OR-Tools CP-SAT. The architecture can still be extended with Gurobi, CPLEX, FastAPI, SQL storage, authentication, observability, and ERP/MES integrations.
