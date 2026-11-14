from datetime import timedelta
from hashlib import sha256
from operator import eq, ge, gt, le, lt
from uuid import uuid4

from fastapi import HTTPException
from jsonschema import Draft202012Validator, FormatChecker

from flowent.model import EMPTY_FORM
from flowent.store import many, one, pack, sql


def now(conn):
    return sql(
        conn,
        "SELECT clock_timestamp()+offset_seconds*interval '1 second' FROM settings WHERE id",
    ).scalar_one()


def history(conn, instance, request, actor, action, node=None, **detail):
    sql(
        conn,
        """INSERT INTO events(instance,request,actor,action,node,detail,created_at)
                VALUES (:i,:r,:a,:action,:node,CAST(:detail AS jsonb),:now)""",
        i=instance,
        r=request,
        a=actor,
        action=action,
        node=node,
        detail=pack(detail),
        now=now(conn),
    )


def validate_form(schema, data):
    errors = sorted(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(data),
        key=lambda error: (tuple(map(str, error.path)), error.validator),
    )
    if errors:
        raise HTTPException(
            422,
            {
                "code": "FORM_INVALID",
                "issues": [
                    {"field": "/".join(map(str, e.path)), "rule": e.validator}
                    for e in errors[:15]
                ],
            },
        )


compare = {"eq": eq, "gt": gt, "gte": ge, "lt": lt, "lte": le}


def select_flow(node, config, values):
    for id in node["outgoing"]:
        if id == node["default"]:
            continue
        rule = config["rules"][id]
        scope, field = rule["field"].split("/")
        actual = values.get(scope, {}).get(field)
        expected = rule["value"]
        if type(actual) is not type(expected):
            continue
        if compare[rule["op"]](actual, expected):
            return id
    return node["default"]


def token(conn, instance, node, stack):
    return one(
        conn,
        """INSERT INTO tokens(instance,node,stack,status)
                       VALUES (:i,:n,CAST(:s AS jsonb),'READY') RETURNING *""",
        i=instance,
        n=node,
        s=pack(stack),
    )


def set_token(conn, row, status):
    sql(conn, "UPDATE tokens SET status=:s WHERE id=:id", s=status, id=row["id"])


def drive(conn, instance, request, actor):
    id = instance["id"]
    model = instance["model"]
    config = model["config"]
    for _ in range(1000):
        row = one(
            conn,
            "SELECT * FROM tokens WHERE instance=:i AND status='READY' ORDER BY id LIMIT 1",
            i=id,
        )
        if not row:
            break
        node = model["nodes"][row["node"]]
        kind = node["kind"]
        name = node["id"]
        outs = node["outgoing"]
        stack = row["stack"]
        history(conn, id, request, actor, "ENTERED", name, token=row["id"])
        if kind == "userTask":
            task = config["tasks"][name]
            sql(
                conn,
                """INSERT INTO tasks(instance,token,node,name,work_group,form,priority,due_at)
                        VALUES (:i,:t,:node,:name,:group,CAST(:form AS jsonb),:priority,:due)""",
                i=id,
                t=row["id"],
                node=name,
                name=node["name"],
                group=task["group"],
                form=pack(task.get("form", EMPTY_FORM)),
                priority=task.get("priority", 50),
                due=now(conn) + timedelta(seconds=task.get("sla", 3600)),
            )
            set_token(conn, row, "TASK")
            continue
        if kind in {"intermediateCatchEvent", "serviceTask"}:
            state = "TIMER" if kind == "intermediateCatchEvent" else "SERVICE"
            sql(
                conn,
                "INSERT INTO jobs(instance,token,kind,due_at) VALUES (:i,:t,:k,:due)",
                i=id,
                t=row["id"],
                k=state,
                due=now(conn) + timedelta(seconds=node.get("seconds", 0)),
            )
            set_token(conn, row, state)
            continue
        if kind == "parallelGateway" and name in config["pairs"]:
            fork = str(uuid4())
            for branch in outs:
                token(
                    conn,
                    id,
                    model["flows"][branch]["target"],
                    [
                        *stack,
                        {
                            "fork": fork,
                            "branch": branch,
                            "split": name,
                            "join": config["pairs"][name],
                        },
                    ],
                )
            set_token(conn, row, "DONE")
            history(conn, id, request, actor, "FORKED", name, fork=fork, branches=outs)
            continue
        if kind == "parallelGateway" and len(node["incoming"]) > 1:
            frame = stack[-1]
            if frame["join"] != name:
                raise RuntimeError("Unexpected join frame")
            sql(
                conn,
                "INSERT INTO joins VALUES (:i,:f,:b,:t)",
                i=id,
                f=frame["fork"],
                b=frame["branch"],
                t=row["id"],
            )
            set_token(conn, row, "JOIN")
            done = many(
                conn,
                "SELECT branch,token FROM joins WHERE instance=:i AND fork=:f",
                i=id,
                f=frame["fork"],
            )
            expected = set(model["nodes"][frame["split"]]["outgoing"])
            if {entry["branch"] for entry in done} != expected:
                continue
            sql(
                conn,
                """UPDATE tokens SET status='DONE' WHERE id IN
                       (SELECT token FROM joins WHERE instance=:i AND fork=:f)""",
                i=id,
                f=frame["fork"],
            )
            history(
                conn,
                id,
                request,
                actor,
                "JOINED",
                name,
                fork=frame["fork"],
                branches=sorted(expected),
            )
            stack = stack[:-1]
        else:
            set_token(conn, row, "DONE")
        if outs:
            flow = (
                select_flow(node, config, instance["vars"])
                if len(outs) > 1
                else outs[0]
            )
            history(conn, id, request, actor, "FLOW", name, flow=flow)
            token(conn, id, model["flows"][flow]["target"], stack)
    else:
        raise RuntimeError("Synchronous step budget exceeded")
    if not one(
        conn, "SELECT id FROM tokens WHERE instance=:i AND status<>'DONE' LIMIT 1", i=id
    ):
        sql(
            conn,
            "UPDATE instances SET status='COMPLETED',completed_at=:now WHERE id=:i",
            now=now(conn),
            i=id,
        )
        history(conn, id, request, actor, "COMPLETED")


def locked_instance(conn, id):
    return one(
        conn,
        """SELECT i.*,v.model FROM instances i JOIN versions v ON v.id=i.version
                      WHERE i.id=:i FOR UPDATE OF i""",
        i=id,
    )


def receipt(conn, actor, key, payload, operation):
    fingerprint = sha256(pack(payload).encode()).hexdigest()
    sql(
        conn, "SELECT pg_advisory_xact_lock(hashtextextended(:k,0))", k=f"{actor}:{key}"
    )
    old = one(
        conn,
        "SELECT digest,response FROM receipts WHERE actor=:a AND key=:k",
        a=actor,
        k=key,
    )
    if old:
        if old["digest"] != fingerprint:
            raise HTTPException(409, "KEY_CONFLICT")
        return {**old["response"], "replayed": True}
    result = operation()
    sql(
        conn,
        "INSERT INTO receipts VALUES (:a,:k,:d,CAST(:r AS jsonb))",
        a=actor,
        k=key,
        d=fingerprint,
        r=pack(result),
    )
    return {**result, "replayed": False}


def finish_token(conn, instance, token_id, request, actor):
    row = one(conn, "SELECT * FROM tokens WHERE id=:id", id=token_id)
    target = instance["model"]["nodes"][row["node"]]["outgoing"][0]
    set_token(conn, row, "DONE")
    token(
        conn, instance["id"], instance["model"]["flows"][target]["target"], row["stack"]
    )
    drive(conn, instance, request, actor)


def tick(conn):
    instant = now(conn)
    candidate = one(
        conn,
        """SELECT j.id,j.instance FROM jobs j JOIN instances i ON i.id=j.instance
                        WHERE j.status='WAITING' AND j.due_at<=:now AND i.status='RUNNING'
                        ORDER BY j.due_at,j.id LIMIT 1""",
        now=instant,
    )
    if candidate:
        item = locked_instance(conn, candidate["instance"])
        job = one(
            conn,
            "SELECT * FROM jobs WHERE id=:id AND status='WAITING' AND due_at<=:now FOR UPDATE",
            id=candidate["id"],
            now=instant,
        )
        if job and item["status"] == "RUNNING":
            process_job(conn, item, job, instant)
    late = many(
        conn,
        """UPDATE tasks t SET escalated=true WHERE t.id IN
                  (SELECT id FROM tasks WHERE status<>'DONE' AND NOT escalated AND due_at<=:now
                   ORDER BY due_at LIMIT 25 FOR UPDATE SKIP LOCKED) RETURNING instance,node,id""",
        now=instant,
    )
    for task in late:
        history(
            conn,
            task["instance"],
            uuid4(),
            None,
            "SLA_BREACH",
            task["node"],
            task=task["id"],
        )
    return bool(candidate or late)


def process_job(conn, item, job, instant):
    id = item["id"]
    request = uuid4()
    row = one(conn, "SELECT * FROM tokens WHERE id=:id", id=job["token"])
    action = item["model"]["config"]["actions"].get(row["node"])
    failed = (
        action
        and action["type"] == "guard"
        and sql(conn, "SELECT fault FROM settings WHERE id").scalar_one()
    )
    count = job["attempts"] + 1
    if failed:
        blocked = count >= 3
        sql(
            conn,
            "UPDATE jobs SET status=:s,attempts=:a,error='GUARD_UNAVAILABLE',due_at=:d WHERE id=:id",
            s="BLOCKED" if blocked else "WAITING",
            a=count,
            d=instant + timedelta(seconds=2**count),
            id=job["id"],
        )
        if blocked:
            sql(conn, "UPDATE instances SET status='INCIDENT' WHERE id=:id", id=id)
            sql(
                conn,
                "INSERT INTO incidents(job,instance,code,opened) VALUES (:j,:i,'GUARD_UNAVAILABLE',:now)",
                j=job["id"],
                i=id,
                now=instant,
            )
        history(
            conn,
            id,
            request,
            None,
            "INCIDENT" if blocked else "SERVICE_RETRY",
            row["node"],
            attempt=count,
        )
        return
    sql(
        conn,
        "UPDATE jobs SET status='DONE',attempts=:a,error=NULL WHERE id=:id",
        a=count,
        id=job["id"],
    )
    history(
        conn,
        id,
        request,
        None,
        "TIMER_FIRED" if action is None else "SERVICE_DONE",
        row["node"],
        attempt=count,
        action_config=action,
    )
    if action and action["type"] == "notify":
        history(
            conn,
            id,
            request,
            None,
            "NOTIFICATION",
            row["node"],
            message=action["message"],
        )
    finish_token(conn, item, job["token"], request, None)
