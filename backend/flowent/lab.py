from concurrent.futures import ThreadPoolExecutor
from enum import StrEnum
from time import monotonic, sleep
from uuid import uuid4

import httpx

from flowent.access import digest, token_urlsafe
from flowent.store import db, many, sql


class Scenario(StrEnum):
    parallel = "parallel"
    success = "success"
    branch = "branch"
    revision = "revision"
    reject = "reject"
    sla = "sla"
    timer = "timer"
    replay = "replay"
    concurrent = "concurrent"
    incident = "incident"
    recover = "recover"
    version = "version"
    invalid = "invalid"
    forbidden = "forbidden"


def run(scenario):
    actors = {}
    names = ["employee", "other", "approver", "finance", "admin", "analyst", "manager"]
    with db.begin() as conn:
        for row in many(
            conn, "SELECT id,login FROM users WHERE login=ANY(:names)", names=names
        ):
            token = token_urlsafe(32)
            actors[row["login"]] = token
            sql(
                conn,
                "INSERT INTO sessions VALUES (:d,:u,clock_timestamp()+interval '5 minutes')",
                d=digest(token),
                u=row["id"],
            )
    traffic = []
    checks = {}
    id = None
    events = []
    try:
        with httpx.Client(
            base_url="http://127.0.0.1:8000/api/", timeout=8, trust_env=False
        ) as client:

            def call(actor, method, path, data=None, expected=200, key=None):
                resp = client.request(
                    method,
                    path,
                    json=data,
                    headers={
                        "Authorization": "Bearer " + actors[actor],
                        "Idempotency-Key": key or uuid4().hex,
                    },
                )
                value = resp.json()
                traffic.append(
                    {
                        "role": actor,
                        "method": method,
                        "path": path,
                        "body": data,
                        "status": resp.status_code,
                        "request": resp.headers["X-Request-ID"],
                        "response": value,
                    }
                )
                if resp.status_code != expected:
                    raise RuntimeError(
                        f"Unexpected HTTP response at {path}: {resp.status_code}"
                    )
                return value

            def clock(seconds=0, fault=None):
                return call(
                    "admin", "PUT", "lab/clock", {"seconds": seconds, "fault": fault}
                )

            definitions = call("employee", "GET", "process-definitions")
            definition = next(d for d in definitions if d["code"] == "EXPENSE")
            path = "process-definitions/" + definition["id"]
            large = scenario in {
                Scenario.parallel,
                Scenario.branch,
                Scenario.concurrent,
            }
            input_data = {
                "values": {
                    "amount": 150000 if large else 12000,
                    "category": "equipment",
                    "purpose": "Эксперимент Flowent",
                }
            }
            if scenario == Scenario.invalid:
                item = call("analyst", "GET", path)
                value = call(
                    "analyst",
                    "POST",
                    "validate",
                    {
                        "name": item["name"],
                        "revision": item["revision"],
                        "xml": item["draft"].replace("userTask", "manualTask"),
                    },
                    422,
                )
                checks["model_rejected"] = value["detail"]["code"] == "MODEL_INVALID"
                return {
                    "passed": all(checks.values()),
                    "instance": id,
                    "checks": checks,
                    "events": events,
                    "traffic": traffic,
                }

            started = call("employee", "POST", path + "/start", input_data, 201)
            id = started["id"]
            state_path = "process-instances/" + id

            def read():
                return call("employee", "GET", state_path)

            def wait(test):
                deadline = monotonic() + 8
                while monotonic() < deadline:
                    state = read()
                    if test(state):
                        return state
                    sleep(0.3)
                raise RuntimeError("Worker did not reach expected state")

            def task(node):
                return next(
                    t
                    for t in read()["tasks"]
                    if t["node"] == node and t["status"] != "DONE"
                )

            def cmd(id, actor, action, values=None, expected=200, key=None):
                return call(
                    actor,
                    "POST",
                    f"tasks/{id}/{action}",
                    {"values": values or {}},
                    expected,
                    key,
                )

            def complete(node, actor, values):
                row = task(node)
                cmd(row["id"], actor, "claim")
                return cmd(row["id"], actor, "complete", values)

            approved = {"result": "approve", "comment": "Учебное согласование"}
            if large:
                lead, second = task("Lead"), task("Second")
                checks["two_branches"] = lead["id"] != second["id"]
                if scenario != Scenario.branch:
                    cmd(lead["id"], "approver", "claim")
                    cmd(second["id"], "finance", "claim")
                    if scenario == Scenario.concurrent:
                        with ThreadPoolExecutor(2) as pool:
                            first = pool.submit(
                                cmd, lead["id"], "approver", "complete", approved
                            )
                            last = pool.submit(
                                cmd, second["id"], "finance", "complete", approved
                            )
                            checks["two_commits"] = all(
                                row["status"] == "DONE"
                                for row in (first.result(), last.result())
                            )
                    else:
                        cmd(lead["id"], "approver", "complete", approved)
                        intermediate = read()
                        checks["join_waits"] = {
                            t["status"] for t in intermediate["tokens"]
                        } == {"JOIN", "TASK"}
                        cmd(second["id"], "finance", "complete", approved)
                    checks["single_join"] = (
                        sum(e["action"] == "JOINED" for e in read()["events"]) == 1
                    )
            elif scenario == Scenario.forbidden:
                value = call("other", "GET", state_path, expected=404)
                row = task("Solo")
                cmd(row["id"], "other", "claim", expected=404)
                checks["scope_denied"] = value["detail"] == "INSTANCE_NOT_FOUND"
            elif scenario == Scenario.sla:
                clock(12)
                value = wait(
                    lambda i: any(e["action"] == "SLA_BREACH" for e in i["events"])
                )
                checks["escalated"] = any(t["escalated"] for t in value["tasks"])
            elif scenario == Scenario.version:
                import uuid

                item = call("analyst", "GET", path)
                unique = uuid.uuid4().hex[:8].upper()
                # Change a newly created definition so concurrent experiments do not replace fixture versions.
                custom = call(
                    "analyst",
                    "POST",
                    "process-definitions",
                    {
                        "code": "LAB-" + unique,
                        "name": "Сравнение версий",
                        "xml": item["draft"],
                    },
                    201,
                )
                draft_path = "process-definitions/" + custom["id"]
                old = call(
                    "manager", "POST", draft_path + "/publish", {"revision": 1}, 201
                )
                started = call(
                    "employee", "POST", draft_path + "/start", input_data, 201
                )
                edited = call(
                    "analyst",
                    "PUT",
                    draft_path,
                    {
                        "name": custom["name"],
                        "revision": 2,
                        "xml": custom["draft"] + "\n",
                    },
                )
                new = call(
                    "manager",
                    "POST",
                    draft_path + "/publish",
                    {"revision": edited["revision"]},
                    201,
                )
                current = call(
                    "employee", "POST", draft_path + "/start", input_data, 201
                )
                id = started["id"]
                state_path = "process-instances/" + id
                checks["pinned_version"] = (
                    read()["version"] == old["id"] and current["version"] == new["id"]
                )
            elif scenario == Scenario.revision:
                complete(
                    "Solo",
                    "approver",
                    {"result": "revise", "comment": "Добавьте уточнение"},
                )
                complete("Revision", "employee", {"note": "Уточнение предоставлено"})
                checks["new_task"] = (
                    sum(t["node"] == "Solo" for t in read()["tasks"]) == 2
                )
            elif scenario == Scenario.reject:
                complete(
                    "Solo", "approver", {"result": "reject", "comment": "Отклонено"}
                )
                checks["rejected_route"] = any(
                    e["node"] == "Reject" for e in read()["events"]
                )
            elif scenario == Scenario.replay:
                row = task("Solo")
                key = uuid4().hex
                cmd(row["id"], "approver", "claim")
                cmd(row["id"], "approver", "complete", approved, key=key)
                checks["replayed"] = cmd(
                    row["id"], "approver", "complete", approved, key=key
                )["replayed"]
                checks["single_completion"] = (
                    sum(e["action"] == "TASK_COMPLETED" for e in read()["events"]) == 1
                )
            else:
                failed = scenario in {Scenario.incident, Scenario.recover}
                if failed:
                    clock(fault=True)
                try:
                    complete("Solo", "approver", approved)
                    clock(6)
                    if failed:
                        for count in (1, 2, 3):
                            wait(
                                lambda i, count=count: any(
                                    j["kind"] == "SERVICE" and j["attempts"] == count
                                    for j in i["jobs"]
                                )
                            )
                            if count < 3:
                                clock(10)
                        checks["blocked"] = read()["status"] == "INCIDENT"
                        if scenario == Scenario.recover:
                            clock(fault=False)
                            incident = next(
                                x
                                for x in call("admin", "GET", "incidents")
                                if x["instance"] == id
                            )
                            call(
                                "admin",
                                "POST",
                                f"incidents/{incident['id']}/retry",
                                {"note": "Учебный сбой снят"},
                            )
                            value = wait(
                                lambda i: any(t["node"] == "Fulfil" for t in i["tasks"])
                            )
                            checks["resumed"] = value["status"] == "RUNNING"
                    else:
                        value = wait(
                            lambda i: any(t["node"] == "Fulfil" for t in i["tasks"])
                        )
                        checks["timer_fired"] = any(
                            e["action"] == "TIMER_FIRED" for e in value["events"]
                        )
                        if scenario == Scenario.success:
                            complete(
                                "Fulfil", "employee", {"note": "Результат подтверждён"}
                            )
                            checks["completed"] = read()["status"] == "COMPLETED"
                finally:
                    if failed:
                        clock(fault=False)
            final = read()
            return {
                "passed": bool(checks) and all(checks.values()),
                "instance": id,
                "checks": checks,
                "events": final["events"],
                "before": started,
                "after": {k: final[k] for k in ("status", "tokens", "jobs", "tasks")},
                "traffic": traffic,
            }
    finally:
        with db.begin() as conn:
            for token in actors.values():
                sql(conn, "DELETE FROM sessions WHERE digest=:d", d=digest(token))
