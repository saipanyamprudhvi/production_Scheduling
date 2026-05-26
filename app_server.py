import csv
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
PUBLIC_DIR = ROOT / "public"
VENDOR_DIR = ROOT / "vendor" / "python"

if VENDOR_DIR.exists():
    sys.path.insert(0, str(VENDOR_DIR))

from src.cp_sat_scheduler import solve

RUN_CACHE = {}


def read_json(file_name):
    return json.loads((DATA_DIR / file_name).read_text(encoding="utf-8"))


def write_json(file_name, value):
    (DATA_DIR / file_name).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def load_dataset():
    return {
        "plant": read_json("plant.json"),
        "jobs": read_json("jobs.json"),
        "scenarios": read_json("scenarios.json"),
        "feedback": read_json("feedback.json"),
    }


def run_scenario(scenario_id):
    dataset = load_dataset()
    scenario = next((item for item in dataset["scenarios"] if item["id"] == scenario_id), None)
    if not scenario:
        return None
    result = solve({"plant": dataset["plant"], "jobs": dataset["jobs"], "scenario": scenario})
    RUN_CACHE[scenario_id] = result
    return result


def schedule_csv(result):
    fields = [
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
        "priority",
    ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for assignment in result["assignments"]:
        writer.writerow(assignment)
    return output.getvalue()


class AppHandler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, status, text, content_type="text/plain"):
        body = text.encode("utf-8") if isinstance(text, str) else text
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed.path)
        else:
            self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_post(parsed.path)
        else:
            self.send_json(404, {"error": "Not found"})

    def handle_api_get(self, path):
        if path == "/api/dashboard":
            dataset = load_dataset()
            latest = RUN_CACHE.get("SCN-BASE") or run_scenario("SCN-BASE")
            self.send_json(200, {**dataset, "latestResult": latest})
            return

        if path == "/api/scenarios":
            self.send_json(200, read_json("scenarios.json"))
            return

        export_match = re.match(r"^/api/scenarios/([^/]+)/export\.csv$", path)
        if export_match:
            scenario_id = export_match.group(1)
            result = RUN_CACHE.get(scenario_id) or run_scenario(scenario_id)
            if not result:
                self.send_json(404, {"error": "Not found"})
                return
            body = schedule_csv(result).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv")
            self.send_header("Content-Disposition", f'attachment; filename="{scenario_id}-schedule.csv"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_json(404, {"error": "Not found"})

    def handle_api_post(self, path):
        if path == "/api/scenarios":
            body = self.read_body()
            scenarios = read_json("scenarios.json")
            scenario = {
                "id": f"SCN-{int(datetime.now(timezone.utc).timestamp() * 1000):X}",
                "name": body.get("name") or "New Scenario",
                "status": "draft",
                "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "solver": "cp-sat",
                "weights": body.get("weights") or {"dueDate": 45, "changeover": 25, "utilization": 20, "inventory": 10},
                "lockedJobs": body.get("lockedJobs") or [],
                "overrides": body.get("overrides") or {},
                "notes": body.get("notes") or "",
            }
            scenarios.insert(0, scenario)
            write_json("scenarios.json", scenarios)
            self.send_json(201, scenario)
            return

        run_match = re.match(r"^/api/scenarios/([^/]+)/run$", path)
        if run_match:
            result = run_scenario(run_match.group(1))
            if not result:
                self.send_json(404, {"error": "Not found"})
                return
            self.send_json(200, result)
            return

        approve_match = re.match(r"^/api/scenarios/([^/]+)/approve$", path)
        if approve_match:
            scenario_id = approve_match.group(1)
            scenarios = read_json("scenarios.json")
            found = False
            for scenario in scenarios:
                if scenario["id"] == scenario_id:
                    scenario["status"] = "approved"
                    found = True
                elif scenario.get("status") == "approved":
                    scenario["status"] = "archived"
            if not found:
                self.send_json(404, {"error": "Not found"})
                return
            write_json("scenarios.json", scenarios)
            self.send_json(200, {"ok": True, "scenarioId": scenario_id})
            return

        if path == "/api/feedback":
            body = self.read_body()
            feedback = read_json("feedback.json")
            record = {
                "id": f"FDB-{int(datetime.now(timezone.utc).timestamp() * 1000):X}",
                "scenarioId": body.get("scenarioId"),
                "jobId": body.get("jobId"),
                "type": body.get("type") or "planner",
                "message": body.get("message") or "",
                "impact": body.get("impact") or "general",
                "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
            feedback.insert(0, record)
            write_json("feedback.json", feedback)
            self.send_json(201, record)
            return

        self.send_json(404, {"error": "Not found"})

    def serve_static(self, request_path):
        safe_path = "/index.html" if request_path == "/" else unquote(request_path)
        file_path = (PUBLIC_DIR / safe_path.lstrip("/")).resolve()
        if not str(file_path).startswith(str(PUBLIC_DIR.resolve())) or not file_path.exists() or file_path.is_dir():
            self.send_json(404, {"error": "Not found"})
            return
        content_types = {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "text/javascript",
            ".svg": "image/svg+xml",
        }
        self.send_text(200, file_path.read_bytes(), content_types.get(file_path.suffix.lower(), "application/octet-stream"))


def main():
    port = int(os.environ.get("PORT", "3001"))
    server = ThreadingHTTPServer(("localhost", port), AppHandler)
    print(f"PRISM Production Scheduling CP-SAT server running at http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
