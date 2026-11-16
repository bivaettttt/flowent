import os
from concurrent.futures import ThreadPoolExecutor
from time import monotonic, sleep
from uuid import uuid4

import httpx
from flowent.store import db, sql
from sqlalchemy.exc import IntegrityError

client = httpx.Client(
    base_url="http://127.0.0.1:8000/api/", timeout=10, trust_env=False
)


def call(actor, method, path, body=None, expected=200, key=None):
    response = client.request(
        method,
        path,
        json=body,
        headers={
            **({"Authorization": "Bearer " + actors[actor]} if actor in actors else {}),
            "Idempotency-Key": key or uuid4().hex,
        },
    )
    assert response.status_code == expected, (path, response.status_code, response.text)
    assert response.headers["X-Request-ID"]
    return response.json()


actors = {}
for user in (
    "employee",
    "other",
    "approver",
    "finance",
    "security",
    "it",
    "analyst",
    "manager",
    "admin",
):
    actors[user] = call(
        user,
        "POST",
        "auth/login",
        {"login": user, "password": os.environ["DEMO_PASSWORD"]},
    )["token"]
defs = {d["code"]: d for d in call("employee", "GET", "process-definitions")}


def start(code, values):
    return call(
        "employee",
        "POST",
        f"process-definitions/{defs[code]['id']}/start",
        {"values": values},
        201,
    )


def state(item):
    return call("employee", "GET", f"process-instances/{item['id']}")


def task(item, node):
    return next(
        t for t in state(item)["tasks"] if t["node"] == node and t["status"] != "DONE"
    )


def wait(item, test):
    end = monotonic() + 8
    while monotonic() < end:
        result = state(item)
        if test(result):
            return result
        sleep(0.2)
    raise AssertionError("Worker did not reach expected state")


def task_cmd(task, actor, action, values=None, expected=200, key=None):
    return call(
        actor,
        "POST",
        f"tasks/{task['id']}/{action}",
        {"values": values or {}},
        expected,
        key,
    )


def complete(item, node, actor, values):
    current = task(item, node)
    task_cmd(current, actor, "claim")
    task_cmd(current, actor, "complete", values)


def clock(seconds=0, fault=None):
    call("admin", "PUT", "lab/clock", {"seconds": seconds, "fault": fault})


approved = {"result": "approve", "comment": "Проверено"}
large = {"amount": 150000, "purpose": "Синтетическая закупка", "category": "equipment"}
small = {**large, "amount": 12000}
parallel = start("EXPENSE", large)
own = call("employee", "GET", "process-instances?status=RUNNING")
assert parallel["id"] in {row["id"] for row in own}
assert all(
    row["owner"] == parallel["owner"] and row["status"] == "RUNNING" for row in own
)
assert parallel["id"] not in {
    row["id"] for row in call("other", "GET", "process-instances")
}
assert parallel["id"] in {
    row["id"] for row in call("manager", "GET", "process-instances")
}
page = call("admin", "GET", "process-instances?offset=1")
assert not page or page[0]["id"] != parallel["id"]
tasks = [task(parallel, "Lead"), task(parallel, "Second")]
call("other", "GET", f"process-instances/{parallel['id']}", expected=404)
task_cmd(tasks[1], "approver", "claim", expected=404)
task_cmd(tasks[0], "approver", "claim")
task_cmd(tasks[1], "finance", "claim")
key = uuid4().hex
task_cmd(tasks[0], "approver", "complete", {}, 422)
task_cmd(tasks[0], "approver", "complete", approved, key=key)
assert task_cmd(tasks[0], "approver", "complete", approved, key=key)["replayed"]
task_cmd(tasks[0], "approver", "complete", approved, 409)
snapshot = state(parallel)
assert {t["status"] for t in snapshot["tokens"]} == {"JOIN", "TASK"}
assert not snapshot["jobs"]
task_cmd(tasks[1], "finance", "complete", approved)
assert [e["action"] for e in state(parallel)["events"]].count("JOINED") == 1
clock(6)
wait(parallel, lambda row: any(t["node"] == "Fulfil" for t in row["tasks"]))
complete(parallel, "Fulfil", "employee", {"note": "Получено"})
assert state(parallel)["status"] == "COMPLETED"

travel = start(
    "TRAVEL",
    {
        "destination": "Томск",
        "date": "2027-01-03",
        "budget": 20000,
        "purpose": "Встреча",
    },
)
clock(12)
wait(travel, lambda row: any(e["action"] == "SLA_BREACH" for e in row["events"]))
complete(travel, "Solo", "approver", {"result": "revise", "comment": "Уточнить цель"})
complete(travel, "Revision", "employee", {"note": "Учебное уточнение"})
complete(travel, "Solo", "approver", {"result": "reject", "comment": "Учебный отказ"})
assert state(travel)["status"] == "COMPLETED"
assert state(travel)["events"][-2]["node"] == "Reject"

access = start(
    "ACCESS",
    {"system": "Demo Inventory", "privileged": True, "purpose": "Учебный доступ"},
)
for node, actor in [("Lead", "approver"), ("Second", "security")]:
    task_cmd(task(access, node), actor, "claim")


def finish(args):
    node, actor = args
    return task_cmd(task(access, node), actor, "complete", approved)


with ThreadPoolExecutor(2) as pool:
    assert (
        len(list(pool.map(finish, [("Lead", "approver"), ("Second", "security")]))) == 2
    )
clock(6)
wait(access, lambda row: any(t["node"] == "Fulfil" for t in row["tasks"]))
complete(access, "Fulfil", "it", {"note": "Доступ предоставлен"})
assert state(access)["status"] == "COMPLETED"

failure = start("EXPENSE", small)
clock(0, True)
complete(failure, "Solo", "approver", approved)
clock(6)
for attempt in (1, 2, 3):
    wait(
        failure,
        lambda row, attempt=attempt: any(
            j["attempts"] == attempt and j["kind"] == "SERVICE" for j in row["jobs"]
        ),
    )
    if attempt < 3:
        clock(10)
assert state(failure)["status"] == "INCIDENT"
incident_path = f"incidents?instance={failure['id']}"
incident = call("admin", "GET", incident_path)[0]
assert incident["recovery"] == "OPEN" and incident["recovered_at"] is None
clock(0, False)
call(
    "admin",
    "POST",
    f"incidents/{incident['id']}/retry",
    {"note": "Предусловие восстановлено"},
)
wait(failure, lambda row: any(t["node"] == "Fulfil" for t in row["tasks"]))
recovered = call("admin", "GET", incident_path)[0]
assert recovered["id"] == incident["id"]
assert recovered["recovery"] == "RECOVERED" and recovered["recovered_at"]
assert recovered["resolved"] <= recovered["recovered_at"]
call("employee", "GET", incident_path, expected=403)

definition = defs["EXPENSE"]
path = "process-definitions/" + definition["id"]
old = start("EXPENSE", small)
old_xml = state(old)["xml"]
data = call("analyst", "GET", path)
invalid = data["draft"].replace("userTask", "manualTask")
call(
    "analyst",
    "POST",
    "validate",
    {"name": "Invalid", "revision": 1, "xml": invalid},
    422,
)
check = call(
    "analyst",
    "POST",
    "validate",
    {"name": data["name"], "revision": data["revision"], "xml": data["draft"]},
)
updated = call(
    "analyst",
    "PUT",
    path,
    {"name": data["name"], "revision": data["revision"], "xml": data["draft"] + "\n"},
)
call("employee", "POST", path + "/publish", {"revision": updated["revision"]}, 403)
assert (
    call(
        "manager",
        "POST",
        path + "/publish",
        {"revision": updated["revision"], "validated_digest": check["digest"]},
        409,
    )["detail"]
    == "VALIDATION_SNAPSHOT_CHANGED"
)
confirmed = call(
    "manager",
    "POST",
    "validate",
    {"name": updated["name"], "revision": updated["revision"], "xml": updated["draft"]},
)
assert (
    call(
        "manager",
        "POST",
        path + "/publish",
        {"revision": data["revision"], "validated_digest": confirmed["digest"]},
        409,
    )["detail"]
    == "REVISION_CONFLICT"
)
published = call(
    "manager",
    "POST",
    path + "/publish",
    {"revision": updated["revision"], "validated_digest": confirmed["digest"]},
    201,
)
assert old["version"] != published["id"]
assert state(old)["version"] == old["version"]
assert state(old)["xml"] == old_xml
new = start("EXPENSE", small)
assert new["version"] == published["id"]
assert state(new)["xml"] == updated["draft"]
assert old["id"] not in {
    row["id"]
    for row in call("employee", "GET", f"process-instances?version={published['id']}")
}
try:
    with db.begin() as conn:
        sql(conn, "UPDATE versions SET xml='bad' WHERE id=:id", id=published["id"])
except IntegrityError:
    pass
else:
    raise AssertionError("Published version was mutable")
print(
    "Verified real BPMN routes, all three models, role scope, parallel join, concurrency, replay, SLA, timers, incident recovery and version pinning"
)
