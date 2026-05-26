import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app_server import load_dataset, run_scenario

dataset = load_dataset()
result = run_scenario(dataset["scenarios"][0]["id"])

assert result["model"] == "Google OR-Tools CP-SAT"
assert len(result["assignments"]) == len(dataset["jobs"])
assert result["kpis"]["solverStatus"] in ("OPTIMAL", "FEASIBLE")

for assignment in result["assignments"]:
    job = next(item for item in dataset["jobs"] if item["id"] == assignment["jobId"])
    line = next(item for item in dataset["plant"]["lines"] if item["id"] == assignment["lineId"])
    assert job["family"] in line["supportedFamilies"]
    assert assignment["end"] > assignment["start"]

print("Python CP-SAT end-to-end test passed")
