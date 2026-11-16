from datetime import timedelta
from hashlib import sha256

from fastapi import HTTPException

from flowent.engine import (
    drive,
    finish_token,
    history,
    locked_instance,
    now,
    token,
    validate_form,
)
from flowent.model import EMPTY_FORM, compile_model
from flowent.store import many, one, pack, sql

MANAGEMENT = {"PROCESS_MANAGER", "ADMIN"}


def model_digest(xml):
    return sha256(xml.encode()).hexdigest()


def publish(conn, id, actor, request, revision, validated_digest=None):
    definition = one(conn, "SELECT * FROM definitions WHERE id=:i FOR UPDATE", i=id)
    if not definition:
        raise HTTPException(404, "DEFINITION_NOT_FOUND")
    if definition["revision"] != revision or definition["archived"]:
        raise HTTPException(409, "REVISION_CONFLICT")
    draft = definition["draft"]
    if validated_digest is not None and model_digest(draft) != validated_digest:
        raise HTTPException(409, "VALIDATION_SNAPSHOT_CHANGED")
    model = compile_model(draft)
    groups = {task["group"] for task in model["config"]["tasks"].values()} - {
        "employees"
    }
    for group in sorted(groups):
        if not one(
            conn,
            "SELECT id FROM users WHERE :g=ANY(groups) AND role IN ('EMPLOYEE','APPROVER') LIMIT 1",
            g=group,
        ):
            raise HTTPException(422, {"code": "GROUP_EMPTY", "group": group})

    previous = one(
        conn, "SELECT xml FROM versions WHERE id=:i", i=definition["active_version"]
    )
    if previous and previous["xml"] == definition["draft"]:
        raise HTTPException(409, "ALREADY_PUBLISHED")
    item = one(
        conn,
        """INSERT INTO versions(definition,number,xml,model,actor)
                    VALUES (:i,(SELECT COALESCE(max(number),0)+1 FROM versions WHERE definition=:i),
                    :xml,CAST(:model AS jsonb),:actor) RETURNING id,definition,number,created_at""",
        i=id,
        xml=definition["draft"],
        model=pack(model),
        actor=actor,
    )
    sql(
        conn,
        "UPDATE definitions SET active_version=:v,revision=revision+1 WHERE id=:i",
        i=id,
        v=item["id"],
    )
    history(conn, None, request, actor, "PUBLISHED", definition=id, version=item["id"])
    return item


def start(conn, definition, actor, request, values):
    target = one(
        conn,
        """SELECT v.id,v.model FROM definitions d JOIN versions v ON v.id=d.active_version
                       WHERE d.id=:i AND NOT d.archived FOR SHARE OF d""",
        i=definition,
    )
    if not target:
        raise HTTPException(409, "PROCESS_UNAVAILABLE")
    model = target["model"]
    validate_form(model["config"].get("input", EMPTY_FORM), values)
    instant = now(conn)
    item = one(
        conn,
        """INSERT INTO instances(version,owner,vars,created_at,due_at)
                     VALUES (:v,:u,CAST(:vars AS jsonb),:now,:due) RETURNING *""",
        v=target["id"],
        u=actor,
        vars=pack({"input": values}),
        now=instant,
        due=instant + timedelta(seconds=model["config"].get("sla", 86400)),
    )
    item["model"] = model
    history(conn, item["id"], request, actor, "STARTED", version=target["id"])
    token(conn, item["id"], model["start"], [])
    drive(conn, item, request, actor)
    return one(conn, "SELECT * FROM instances WHERE id=:i", i=item["id"])


def task_access(task, instance, actor):
    return actor["role"] in {"EMPLOYEE", "APPROVER"} and (
        task["work_group"] in actor["groups"]
        and (task["work_group"] != "employees" or instance["owner"] == actor["id"])
        and (task["assignee"] is None or task["assignee"] == actor["id"])
    )


def task_action(conn, id, actor, request, action, data):
    task = one(conn, "SELECT * FROM tasks WHERE id=:i", i=id)
    if not task:
        raise HTTPException(404, "TASK_NOT_FOUND")
    instance = locked_instance(conn, task["instance"])
    task = one(conn, "SELECT * FROM tasks WHERE id=:i FOR UPDATE", i=id)
    if not task_access(task, instance, actor):
        raise HTTPException(404, "TASK_NOT_FOUND")
    if instance["status"] != "RUNNING" or task["status"] == "DONE":
        raise HTTPException(409, "TASK_CLOSED")
    if action == "claim":
        if task["status"] != "OPEN":
            raise HTTPException(409, "ALREADY_CLAIMED")
        sql(
            conn,
            "UPDATE tasks SET status='CLAIMED',assignee=:a WHERE id=:i",
            a=actor["id"],
            i=id,
        )
        history(
            conn,
            instance["id"],
            request,
            actor["id"],
            "TASK_CLAIMED",
            task["node"],
            task=id,
        )
    else:
        if task["status"] != "CLAIMED":
            raise HTTPException(409, "CLAIM_REQUIRED")
        validate_form(task["form"], data)
        sql(
            conn,
            "UPDATE tasks SET status='DONE',submission=CAST(:data AS jsonb),completed_at=:now WHERE id=:i",
            data=pack(data),
            now=now(conn),
            i=id,
        )
        instance["vars"][task["node"]] = data
        sql(
            conn,
            "UPDATE instances SET vars=CAST(:data AS jsonb) WHERE id=:i",
            data=pack(instance["vars"]),
            i=instance["id"],
        )
        history(
            conn,
            instance["id"],
            request,
            actor["id"],
            "TASK_COMPLETED",
            task["node"],
            task=id,
        )
        finish_token(conn, instance, task["token"], request, actor["id"])
    return one(conn, "SELECT * FROM tasks WHERE id=:i", i=id)


def retry(conn, id, actor, request, note):
    record = one(conn, "SELECT * FROM incidents WHERE id=:i", i=id)
    if not record:
        raise HTTPException(404, "INCIDENT_NOT_FOUND")
    instance = locked_instance(conn, record["instance"])
    record = one(conn, "SELECT * FROM incidents WHERE id=:i FOR UPDATE", i=id)
    if record["resolved"] or instance["status"] != "INCIDENT":
        raise HTTPException(409, "INCIDENT_CLOSED")
    instant = now(conn)
    sql(
        conn,
        "UPDATE incidents SET resolved=:t,note=:n WHERE id=:i",
        t=instant,
        n=note,
        i=id,
    )
    sql(
        conn,
        "UPDATE jobs SET status='WAITING',attempts=0,due_at=:t WHERE id=:j",
        t=instant,
        j=record["job"],
    )
    sql(conn, "UPDATE instances SET status='RUNNING' WHERE id=:i", i=instance["id"])
    history(
        conn, instance["id"], request, actor, "MANUAL_RETRY", incident=id, note=note
    )
    return {"id": id, "queued": True}


def visible(conn, id, actor):
    item = one(
        conn,
        """SELECT i.*,v.xml,v.number,d.name,u.name AS initiator FROM instances i JOIN versions v ON v.id=i.version
                    JOIN users u ON u.id=i.owner
                    JOIN definitions d ON d.id=v.definition WHERE i.id=:i""",
        i=id,
    )
    if not item:
        raise HTTPException(404, "INSTANCE_NOT_FOUND")
    tasks = many(conn, "SELECT * FROM tasks WHERE instance=:i ORDER BY due_at,id", i=id)
    if (
        actor["role"] not in MANAGEMENT
        and actor["id"] != item["owner"]
        and not any(task_access(t, item, actor) for t in tasks)
    ):
        raise HTTPException(404, "INSTANCE_NOT_FOUND")
    return {
        **item,
        "tasks": tasks,
        "tokens": many(
            conn,
            "SELECT * FROM tokens WHERE instance=:i AND status<>'DONE' ORDER BY node,id",
            i=id,
        ),
        "events": many(
            conn, "SELECT * FROM events WHERE instance=:i ORDER BY id", i=id
        ),
        "jobs": many(
            conn, "SELECT * FROM jobs WHERE instance=:i ORDER BY due_at,id", i=id
        ),
    }
