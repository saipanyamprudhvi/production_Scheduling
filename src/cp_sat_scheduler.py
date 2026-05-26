import json
import math
import os
import sys
import time
from datetime import datetime, timedelta, timezone

VENDOR_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "vendor", "python"))
if os.path.isdir(VENDOR_DIR):
    sys.path.insert(0, VENDOR_DIR)

from ortools.sat.python import cp_model


DAY_MINUTES = 24 * 60


def iso_at_day_start(date_text):
    return datetime.fromisoformat(f"{date_text}T08:00:00+00:00")


def iso_from_offset(first_date, offset_minutes):
    value = iso_at_day_start(first_date) + timedelta(minutes=int(offset_minutes))
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def day_offset(index):
    return index * DAY_MINUTES


def demand_quantity(job):
    return max(int(job["minLotSize"]), int(job["quantity"]) - int(job["inventoryOnHand"]))


def run_minutes(job):
    return int(math.ceil(demand_quantity(job) * float(job["unitRunMinutes"])))


def changeover_minutes(line, previous_family, next_family):
    matrix = line.get("changeoverMatrixMinutes", {})
    if previous_family == next_family:
        return int(matrix.get(previous_family, {}).get(next_family, 0))
    return int(matrix.get(previous_family, {}).get(next_family, 75))


def due_offset_minutes(job, first_date):
    first = datetime.fromisoformat(f"{first_date}T00:00:00+00:00")
    due = datetime.fromisoformat(f"{job['dueDate']}T23:59:00+00:00")
    return int((due - first).total_seconds() // 60)


def line_day_capacity_minutes(line, calendar_day):
    return int(min(float(calendar_day["shiftHours"]), float(line["dailyCapacityHours"])) * 60)


def solve(payload):
    started = time.perf_counter()
    plant = payload["plant"]
    jobs = payload["jobs"]
    scenario = payload["scenario"]
    weights = scenario.get("weights", {})
    first_date = plant["calendar"][0]["date"]

    model = cp_model.CpModel()
    horizon = len(plant["calendar"]) * DAY_MINUTES
    choices = {}
    line_day_intervals = {}

    for job in jobs:
        duration = run_minutes(job)
        job_choices = []
        for line in plant["lines"]:
            if job["family"] not in line["supportedFamilies"]:
                continue
            override = scenario.get("overrides", {}).get(job["id"], {})
            if override.get("lineId") and override["lineId"] != line["id"]:
                continue
            for day_index_value, calendar_day in enumerate(plant["calendar"]):
                capacity = line_day_capacity_minutes(line, calendar_day)
                if capacity <= 0 or duration > capacity:
                    continue
                day_start = day_offset(day_index_value)
                day_end = day_start + capacity
                suffix = f"{job['id']}_{line['id']}_{calendar_day['date']}".replace("-", "_")
                present = model.NewBoolVar(f"present_{suffix}")
                start = model.NewIntVar(day_start, day_end - duration, f"start_{suffix}")
                end = model.NewIntVar(day_start + duration, day_end, f"end_{suffix}")
                interval = model.NewOptionalIntervalVar(start, duration, end, present, f"interval_{suffix}")
                choice = {
                    "job": job,
                    "line": line,
                    "day": calendar_day,
                    "dayIndex": day_index_value,
                    "present": present,
                    "start": start,
                    "end": end,
                    "interval": interval,
                    "duration": duration,
                }
                choices[(job["id"], line["id"], calendar_day["date"])] = choice
                job_choices.append(choice)
                line_day_intervals.setdefault((line["id"], calendar_day["date"]), []).append(choice)

        if not job_choices:
            raise ValueError(f"No feasible line/day choice found for {job['id']}")
        model.AddExactlyOne(choice["present"] for choice in job_choices)

    for line in plant["lines"]:
        for calendar_day in plant["calendar"]:
            day_choices = line_day_intervals.get((line["id"], calendar_day["date"]), [])
            if not day_choices:
                continue
            model.AddNoOverlap(choice["interval"] for choice in day_choices)

            for left_index in range(len(day_choices)):
                for right_index in range(left_index + 1, len(day_choices)):
                    left = day_choices[left_index]
                    right = day_choices[right_index]
                    if left["job"]["id"] == right["job"]["id"]:
                        continue
                    both = model.NewBoolVar(
                        f"same_line_day_{left['job']['id']}_{right['job']['id']}_{line['id']}_{calendar_day['date']}".replace("-", "_")
                    )
                    left_before_right = model.NewBoolVar(
                        f"before_{left['job']['id']}_{right['job']['id']}_{line['id']}_{calendar_day['date']}".replace("-", "_")
                    )
                    right_before_left = model.NewBoolVar(
                        f"before_{right['job']['id']}_{left['job']['id']}_{line['id']}_{calendar_day['date']}".replace("-", "_")
                    )
                    model.AddBoolAnd([left["present"], right["present"]]).OnlyEnforceIf(both)
                    model.AddBoolOr([left["present"].Not(), right["present"].Not(), both])
                    model.Add(left_before_right + right_before_left == 1).OnlyEnforceIf(both)
                    model.Add(left_before_right == 0).OnlyEnforceIf(both.Not())
                    model.Add(right_before_left == 0).OnlyEnforceIf(both.Not())

                    lr_setup = changeover_minutes(line, left["job"]["family"], right["job"]["family"])
                    rl_setup = changeover_minutes(line, right["job"]["family"], left["job"]["family"])
                    model.Add(right["start"] >= left["end"] + lr_setup).OnlyEnforceIf(left_before_right)
                    model.Add(left["start"] >= right["end"] + rl_setup).OnlyEnforceIf(right_before_left)

    objective_terms = []
    due_weight = int(weights.get("dueDate", 45))
    utilization_weight = int(weights.get("utilization", 20))
    inventory_weight = int(weights.get("inventory", 10))
    changeover_weight = int(weights.get("changeover", 25))

    for job in jobs:
        job_choice_values = [
            choice for choice in choices.values() if choice["job"]["id"] == job["id"]
        ]
        completion = model.NewIntVar(0, horizon, f"completion_{job['id']}")
        for choice in job_choice_values:
            model.Add(completion == choice["end"]).OnlyEnforceIf(choice["present"])
        lateness = model.NewIntVar(0, horizon, f"lateness_{job['id']}")
        model.Add(lateness >= completion - due_offset_minutes(job, first_date))
        priority = int(job.get("priority", 1))
        objective_terms.append(lateness * due_weight * priority)
        objective_terms.append(completion * max(1, utilization_weight))
        objective_terms.append(-demand_quantity(job) * inventory_weight)

    # Encourage same-family clustering by preferring low setup families on each line/day.
    for choice in choices.values():
        same_family_setup = changeover_minutes(choice["line"], choice["job"]["family"], choice["job"]["family"])
        objective_terms.append(choice["present"] * same_family_setup * changeover_weight)

    model.Minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(scenario.get("maxSolveSeconds", 8))
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise ValueError(f"CP-SAT could not find a feasible schedule. Status={solver.StatusName(status)}")

    assignments = []
    for job in jobs:
        selected = None
        for choice in choices.values():
            if choice["job"]["id"] == job["id"] and solver.BooleanValue(choice["present"]):
                selected = choice
                break
        if selected is None:
            raise ValueError(f"CP-SAT did not select an assignment for {job['id']}")

        start_value = solver.Value(selected["start"])
        end_value = solver.Value(selected["end"])
        assignment = {
            "jobId": job["id"],
            "customer": job["customer"],
            "partNumber": job["partNumber"],
            "family": job["family"],
            "lineId": selected["line"]["id"],
            "lineName": selected["line"]["name"],
            "start": iso_from_offset(first_date, start_value),
            "end": iso_from_offset(first_date, end_value),
            "runMinutes": selected["duration"],
            "changeoverMinutes": 0,
            "quantity": demand_quantity(job),
            "dueDate": job["dueDate"],
            "priority": job["priority"],
            "explanation": [
                f"CP-SAT selected {selected['line']['name']} and {selected['day']['date']} as the feasible slot.",
                "Line eligibility, daily capacity, calendar, due date pressure, inventory, and lot size were included in the optimization model.",
                f"Solver status: {solver.StatusName(status)} with objective {round(solver.ObjectiveValue(), 2)}.",
            ],
        }
        assignments.append(assignment)

    assignments.sort(key=lambda item: (item["lineId"], item["start"]))
    annotate_changeovers(assignments, plant["lines"])
    kpis = calculate_kpis(assignments, plant["lines"], plant["calendar"])
    kpis["averageSolveTimeMs"] = int((time.perf_counter() - started) * 1000)
    kpis["solverStatus"] = solver.StatusName(status)
    kpis["objectiveValue"] = round(solver.ObjectiveValue(), 2)

    return {
        "scenarioId": scenario["id"],
        "scenarioName": scenario["name"],
        "status": "solved",
        "model": "Google OR-Tools CP-SAT",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "assignments": assignments,
        "kpis": kpis,
        "bottlenecks": sorted(
            [line for line in kpis["utilizationByLine"] if line["utilization"] >= 10],
            key=lambda line: line["utilization"],
            reverse=True,
        )[:3],
        "assumptions": [
            "Google OR-Tools CP-SAT is used as the optimization model.",
            "Jobs are scheduled as non-preemptive operations on one eligible line and one working day.",
            "The model enforces line eligibility, daily capacity, no-overlap, due date pressure, inventory netting, and minimum lot size.",
        ],
    }


def annotate_changeovers(assignments, lines):
    line_by_id = {line["id"]: line for line in lines}
    for line_id in {item["lineId"] for item in assignments}:
        previous = None
        for assignment in sorted([item for item in assignments if item["lineId"] == line_id], key=lambda item: item["start"]):
            line = line_by_id[line_id]
            assignment["changeoverMinutes"] = 0 if previous is None else changeover_minutes(line, previous, assignment["family"])
            previous = assignment["family"]


def calculate_kpis(assignments, lines, calendar):
    total_run = sum(item["runMinutes"] for item in assignments)
    total_changeover = sum(item["changeoverMinutes"] for item in assignments)
    late_jobs = [
        item
        for item in assignments
        if datetime.fromisoformat(item["end"].replace("Z", "+00:00"))
        > datetime.fromisoformat(f"{item['dueDate']}T23:59:00+00:00")
    ]
    total_capacity = sum(
        line_day_capacity_minutes(line, day)
        for line in lines
        for day in calendar
    )
    utilization_by_line = []
    for line in lines:
        used = sum(
            item["runMinutes"] + item["changeoverMinutes"]
            for item in assignments
            if item["lineId"] == line["id"]
        )
        capacity = sum(line_day_capacity_minutes(line, day) for day in calendar)
        utilization_by_line.append(
            {
                "lineId": line["id"],
                "lineName": line["name"],
                "usedMinutes": used,
                "capacityMinutes": capacity,
                "utilization": round((used / capacity) * 100) if capacity else 0,
            }
        )

    return {
        "totalJobs": len(assignments),
        "onTimeDeliveryRate": round(((len(assignments) - len(late_jobs)) / len(assignments)) * 100) if assignments else 0,
        "scheduleAdherenceProjection": max(70, round(97 - len(late_jobs) * 4 - total_changeover / 420)),
        "averageSolveTimeMs": 0,
        "changeoverHours": round(total_changeover / 60, 1),
        "productiveHours": round(total_run / 60, 1),
        "capacityUtilization": round(((total_run + total_changeover) / total_capacity) * 100) if total_capacity else 0,
        "plannerOverrideFrequency": 0,
        "lateJobs": [item["jobId"] for item in late_jobs],
        "utilizationByLine": utilization_by_line,
    }


def main():
    payload = json.loads(sys.stdin.read())
    result = solve(payload)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
