import os
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from flowent import contracts as c
from flowent.access import Actor, authenticate, passwords, role
from flowent.engine import history, now, receipt
from flowent.lab import Scenario, run
from flowent.model import EMPTY_FORM, Invalid, compile_model
from flowent.operations import (
    model_digest,
    publish,
    retry,
    start,
    task_access,
    task_action,
    visible,
)
from flowent.store import db, many, one, sql

app = FastAPI(
    title="Flowent",
    version="1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
D = "/api/process-definitions"
INSTANCES = "/api/process-instances"
Key = Annotated[
    str, Header(alias="Idempotency-Key", pattern=r"^[A-Za-z0-9._-]{1,128}$")
]
AUTHOR = ("PROCESS_ANALYST", "ADMIN")
MANAGE = ("PROCESS_MANAGER", "ADMIN")


@app.middleware("http")
async def correlation(request: Request, call_next):
    request.state.id = uuid4()
    response = await call_next(request)
    response.headers["X-Request-ID"] = str(request.state.id)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(Invalid)
async def invalid(request: Request, error: Invalid):
    return JSONResponse(
        {
            "detail": {
                "code": "MODEL_INVALID",
                "element": error.element,
                "message": str(error),
            }
        },
        422,
    )


@app.get("/health")
def health():
    with db.connect() as conn:
        sql(conn, "SELECT id FROM settings")
    return {"status": "ok"}


@app.post("/api/auth/login")
def login(payload: c.Login):
    return authenticate(payload.login, payload.password)


@app.post("/api/auth/logout", status_code=204)
def logout(actor: Actor):
    with db.begin() as conn:
        sql(conn, "DELETE FROM sessions WHERE digest=:d", d=actor["session"])


@app.get("/api/me")
def me(actor: Actor):
    return {
        **{k: v for k, v in actor.items() if k != "session"},
        "lab": os.getenv("LAB_MODE") == "1" and actor["role"] == "ADMIN",
    }


@app.get("/api/users")
def users(actor: Actor):
    role(actor, "ADMIN")
    with db.connect() as conn:
        return many(conn, "SELECT id,login,name,role,groups FROM users ORDER BY login")


@app.post("/api/users", status_code=201)
def create_user(payload: c.User, actor: Actor, request: Request):
    role(actor, "ADMIN")
    with db.begin() as conn:
        item = one(
            conn,
            """INSERT INTO users(login,name,password,role,groups) VALUES (:login,:name,:password,:role,:groups)
                      ON CONFLICT DO NOTHING RETURNING id,login,name,role,groups""",
            **{**payload.model_dump(), "password": passwords.hash(payload.password)},
        )
        if not item:
            raise HTTPException(409, "LOGIN_EXISTS")
        history(
            conn, None, request.state.id, actor["id"], "USER_CREATED", user=item["id"]
        )
        return item


@app.get(D)
def definitions(
    actor: Actor,
    q: Annotated[str, Query(max_length=100)] = "",
    offset: Annotated[int, Query(ge=0)] = 0,
    archived: bool = False,
    order: Literal["code", "name", "updated"] = "code",
):
    staff = actor["role"] in (*AUTHOR, *MANAGE)
    with db.connect() as conn:
        return many(
            conn,
            """SELECT d.id,d.code,d.name,d.owner,d.revision,d.archived,d.active_version,v.number,
                         COALESCE(change.created_at,v.created_at) AS updated_at
                         FROM definitions d LEFT JOIN versions v ON v.id=d.active_version
                         LEFT JOIN LATERAL (
                           SELECT e.created_at FROM events e WHERE e.instance IS NULL
                             AND e.action IN ('DEFINITION_CREATED','DRAFT_UPDATED','ARCHIVE_CHANGED','PUBLISHED')
                             AND e.detail->>'definition'=d.id::text ORDER BY e.id DESC LIMIT 1
                         ) change ON true
                         WHERE (d.name ILIKE :pattern OR d.code ILIKE :pattern) AND
                         ((:staff AND d.archived=:archived) OR (NOT :staff AND NOT d.archived AND v.id IS NOT NULL))
                         ORDER BY CASE WHEN :sort='name' THEN d.name END,
                           CASE WHEN :sort='updated' THEN COALESCE(change.created_at,v.created_at) END DESC NULLS LAST,
                           d.code LIMIT 50 OFFSET :offset""",
            sort=order,
            staff=staff,
            archived=archived,
            pattern=f"%{q}%",
            offset=offset,
        )


@app.post(D, status_code=201)
def add_definition(payload: c.Draft, actor: Actor, request: Request):
    role(actor, *AUTHOR)
    with db.begin() as conn:
        item = one(
            conn,
            """INSERT INTO definitions(code,name,owner,draft) VALUES (:code,:name,:actor,:xml)
                       ON CONFLICT DO NOTHING RETURNING *""",
            actor=actor["id"],
            **payload.model_dump(),
        )
        if not item:
            raise HTTPException(409, "CODE_EXISTS")
        history(
            conn,
            None,
            request.state.id,
            actor["id"],
            "DEFINITION_CREATED",
            definition=item["id"],
        )
        return item


@app.get(D + "/{id}")
def definition(id: UUID, actor: Actor):
    with db.connect() as conn:
        item = one(conn, "SELECT * FROM definitions WHERE id=:i", i=id)
        if not item:
            raise HTTPException(404, "DEFINITION_NOT_FOUND")
        staff = actor["role"] in (*AUTHOR, *MANAGE)
        current = one(
            conn, "SELECT * FROM versions WHERE id=:i", i=item["active_version"]
        )
        if not staff and (not current or item["archived"]):
            raise HTTPException(404, "DEFINITION_NOT_FOUND")
        versions = (
            many(
                conn,
                "SELECT id,number,created_at,actor FROM versions WHERE definition=:i ORDER BY number DESC",
                i=id,
            )
            if staff
            else []
        )
        return {
            **item,
            "draft": item["draft"] if staff else current["xml"],
            "versions": versions,
            "current": current,
            "input": current["model"]["config"].get("input", EMPTY_FORM)
            if current
            else None,
        }


@app.get(D + "/{id}/versions/{version}")
def version_detail(id: UUID, version: UUID, actor: Actor):
    role(actor, *AUTHOR, *MANAGE)
    with db.connect() as conn:
        value = one(
            conn,
            "SELECT v.*,d.name FROM versions v JOIN definitions d ON d.id=v.definition WHERE v.definition=:i AND v.id=:v",
            i=id,
            v=version,
        )
        if not value:
            raise HTTPException(404, "VERSION_NOT_FOUND")
        return value


@app.put(D + "/{id}")
def update_definition(id: UUID, payload: c.Update, actor: Actor, request: Request):
    role(actor, *AUTHOR)
    with db.begin() as conn:
        item = one(
            conn,
            """UPDATE definitions SET name=:name,draft=:xml,revision=revision+1
                       WHERE id=:i AND revision=:revision AND NOT archived RETURNING *""",
            i=id,
            **payload.model_dump(),
        )
        if not item:
            raise HTTPException(409, "REVISION_CONFLICT")
        history(
            conn, None, request.state.id, actor["id"], "DRAFT_UPDATED", definition=id
        )
        return item


@app.post(D + "/{id}/archive")
def archive(id: UUID, payload: c.Archive, actor: Actor, request: Request):
    role(actor, *MANAGE)
    with db.begin() as conn:
        item = one(
            conn,
            "UPDATE definitions SET archived=:archived,revision=revision+1 WHERE id=:i AND revision=:revision RETURNING id,revision",
            i=id,
            **payload.model_dump(),
        )
        if not item:
            raise HTTPException(409, "REVISION_CONFLICT")
        history(
            conn,
            None,
            request.state.id,
            actor["id"],
            "ARCHIVE_CHANGED",
            definition=id,
            archived=payload.archived,
        )
        return item


@app.post("/api/validate")
def validate(payload: c.Update, actor: Actor):
    role(actor, *AUTHOR, *MANAGE)
    model = compile_model(payload.xml)
    return {
        "valid": True,
        "nodes": len(model["nodes"]),
        "flows": len(model["flows"]),
        "digest": model_digest(payload.xml),
    }


@app.post(D + "/{id}/publish", status_code=201)
def deploy(id: UUID, payload: c.Publish, actor: Actor, request: Request, key: Key):
    role(actor, *MANAGE)
    with db.begin() as conn:
        return receipt(
            conn,
            actor["id"],
            key,
            ["publish", id, payload.model_dump(exclude_none=True)],
            lambda: publish(
                conn,
                id,
                actor["id"],
                request.state.id,
                payload.revision,
                payload.validated_digest,
            ),
        )


@app.post(D + "/{id}/start", status_code=201)
def launch(id: UUID, payload: c.Values, actor: Actor, request: Request, key: Key):
    role(actor, "EMPLOYEE")
    with db.begin() as conn:
        return receipt(
            conn,
            actor["id"],
            key,
            ["start", id, payload.model_dump()],
            lambda: start(conn, id, actor["id"], request.state.id, payload.values),
        )


@app.get(INSTANCES)
def instances(
    actor: Actor,
    status: Literal["RUNNING", "INCIDENT", "COMPLETED"] | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    definition: UUID | None = None,
    version: UUID | None = None,
    q: Annotated[str, Query(max_length=100)] = "",
    order: Literal["newest", "oldest"] = "newest",
):
    with db.connect() as conn:
        return many(
            conn,
            """SELECT i.*,d.name,v.number,v.definition,
                     (SELECT count(*) FROM tasks t WHERE t.instance=i.id AND t.status<>'DONE') AS active_tasks,
                     (SELECT count(*) FROM incidents r WHERE r.instance=i.id AND r.resolved IS NULL) AS open_incidents
                 FROM instances i JOIN versions v ON v.id=i.version
                 JOIN definitions d ON d.id=v.definition WHERE (:staff OR i.owner=:u)
                 AND (CAST(:status AS text) IS NULL OR i.status=:status)
                 AND (CAST(:definition AS uuid) IS NULL OR v.definition=:definition)
                 AND (CAST(:version AS uuid) IS NULL OR i.version=:version)
                 AND (d.name ILIKE :q OR d.code ILIKE :q OR i.id::text ILIKE :q)
                 ORDER BY CASE WHEN :oldest THEN i.created_at END ASC,
                   i.created_at DESC,i.id DESC LIMIT 50 OFFSET :offset""",
            staff=actor["role"] in MANAGE,
            u=actor["id"],
            status=status,
            definition=definition,
            version=version,
            q=f"%{q}%",
            oldest=order == "oldest",
            offset=offset,
        )


@app.get(INSTANCES + "/{id}")
def instance(id: UUID, actor: Actor):
    with db.connect().execution_options(isolation_level="REPEATABLE READ") as conn:
        return visible(conn, id, actor)


@app.get("/api/tasks")
def inbox(
    actor: Actor,
    q: Annotated[str, Query(max_length=100)] = "",
    status: Literal["OPEN", "CLAIMED", "DONE"] | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    role(actor, "EMPLOYEE", "APPROVER")
    with db.connect() as conn:
        return many(
            conn,
            """SELECT t.*,d.name AS process,i.version,v.number,u.name AS assignee_name
                         FROM tasks t JOIN instances i ON i.id=t.instance
                         JOIN versions v ON v.id=i.version JOIN definitions d ON d.id=v.definition
                         LEFT JOIN users u ON u.id=t.assignee
                         WHERE work_group=ANY(:groups) AND (work_group<>'employees' OR i.owner=:u)
                         AND (assignee IS NULL OR assignee=:u) AND t.name ILIKE :q
                         AND ((CAST(:s AS text) IS NULL AND t.status<>'DONE') OR t.status=:s)
                         ORDER BY t.priority DESC,t.due_at,t.id LIMIT 50 OFFSET :offset""",
            groups=actor["groups"],
            u=actor["id"],
            q=f"%{q}%",
            s=status,
            offset=offset,
        )


@app.get("/api/tasks/{id}")
def task(id: UUID, actor: Actor):
    with db.connect() as conn:
        item = one(
            conn,
            """SELECT t.*,i.owner,d.name AS process,i.version,v.number,v.definition,
                      i.vars->'input' AS input,u.name AS assignee_name,
                      (SELECT e.created_at FROM events e WHERE e.instance=i.id AND e.action='ENTERED'
                         AND e.detail->>'token'=t.token::text ORDER BY e.id LIMIT 1) AS started_at
                 FROM tasks t JOIN instances i ON i.id=t.instance
                 JOIN versions v ON v.id=i.version JOIN definitions d ON d.id=v.definition
                 LEFT JOIN users u ON u.id=t.assignee WHERE t.id=:i""",
            i=id,
        )
        if not item or not task_access(item, item, actor):
            raise HTTPException(404, "TASK_NOT_FOUND")
        return {key: value for key, value in item.items() if key != "owner"} | {
            "observed_at": now(conn)
        }


@app.post("/api/tasks/{id}/{action}")
def perform(
    id: UUID,
    action: Literal["claim", "complete"],
    payload: c.Values,
    actor: Actor,
    request: Request,
    key: Key,
):
    role(actor, "EMPLOYEE", "APPROVER")
    with db.begin() as conn:
        return receipt(
            conn,
            actor["id"],
            key,
            [action, id, payload.model_dump()],
            lambda: task_action(
                conn, id, actor, request.state.id, action, payload.values
            ),
        )


@app.get("/api/incidents")
def incidents(actor: Actor, id: UUID | None = None, instance: UUID | None = None):
    role(actor, *MANAGE)
    with db.connect() as conn:
        return many(
            conn,
            """SELECT fault.*,t.node,i.version,v.number,d.name AS process,
                      j.attempts,j.due_at,next.id AS next_incident,next.opened AS next_opened,
                      previous.resolved AS previous_resolved,outcome.created_at AS recovered_at,
                      CASE WHEN fault.resolved IS NULL THEN 'OPEN'
                           WHEN next.id IS NOT NULL THEN 'FAILED'
                           WHEN j.status='DONE' THEN 'RECOVERED'
                           WHEN j.status='WAITING' AND j.attempts>0 THEN 'RETRY_WAITING'
                           WHEN j.status='WAITING' THEN 'QUEUED'
                           ELSE 'UNKNOWN' END AS recovery
                 FROM incidents fault JOIN jobs j ON j.id=fault.job
                 JOIN tokens t ON t.id=j.token JOIN instances i ON i.id=fault.instance
                 JOIN versions v ON v.id=i.version JOIN definitions d ON d.id=v.definition
                 LEFT JOIN LATERAL (
                   SELECT later.id,later.opened FROM incidents later WHERE later.job=fault.job AND later.id<>fault.id
                       AND later.opened>=fault.resolved ORDER BY later.opened,later.id LIMIT 1
                 ) next ON true
                 LEFT JOIN LATERAL (
                   SELECT max(earlier.resolved) AS resolved FROM incidents earlier
                     WHERE earlier.job=fault.job AND earlier.id<>fault.id AND earlier.opened<fault.opened
                 ) previous ON true
                 LEFT JOIN LATERAL (
                   SELECT e.created_at FROM events e WHERE e.instance=fault.instance AND e.action='SERVICE_DONE'
                       AND e.detail->>'job'=j.id::text AND e.created_at>=fault.resolved ORDER BY e.id LIMIT 1
                 ) outcome ON true
                 WHERE (CAST(:id AS uuid) IS NULL OR fault.id=:id)
                     AND (CAST(:instance AS uuid) IS NULL OR fault.instance=:instance)
                 ORDER BY fault.opened DESC,fault.id DESC LIMIT 100""",
            id=id,
            instance=instance,
        )


@app.post("/api/incidents/{id}/retry")
def restart(id: UUID, payload: c.Retry, actor: Actor, request: Request, key: Key):
    role(actor, "ADMIN")
    with db.begin() as conn:
        return receipt(
            conn,
            actor["id"],
            key,
            ["retry", id, payload.model_dump()],
            lambda: retry(conn, id, actor["id"], request.state.id, payload.note),
        )


@app.get("/api/reports")
def reports(actor: Actor):
    role(actor, *MANAGE)
    with db.connect() as conn:
        return {
            "instances": many(
                conn,
                """SELECT d.code,v.number,i.status,count(*) AS count,
                     round(avg(extract(epoch FROM i.completed_at-i.created_at))) AS mean_seconds,
                     count(*) FILTER(WHERE COALESCE(i.completed_at,:now)>i.due_at) AS late
                     FROM instances i JOIN versions v ON v.id=i.version JOIN definitions d ON d.id=v.definition
                     GROUP BY d.code,v.number,i.status ORDER BY d.code,v.number,i.status""",
                now=now(conn),
            ),
            "tasks": many(
                conn,
                """SELECT t.work_group,t.status,u.name AS assignee,count(*) AS count,
                       count(*) FILTER(WHERE escalated) AS escalated,
                       round(percentile_cont(.5) WITHIN GROUP (ORDER BY extract(epoch FROM t.completed_at-e.created_at))::numeric) AS median_seconds,
                       round(percentile_cont(.95) WITHIN GROUP (ORDER BY extract(epoch FROM t.completed_at-e.created_at))::numeric) AS p95_seconds
                    FROM tasks t LEFT JOIN users u ON u.id=t.assignee
                    LEFT JOIN events e ON e.action='ENTERED' AND e.detail->>'token'=t.token::text AND e.instance=t.instance
                    GROUP BY t.work_group,t.status,u.name ORDER BY t.work_group,t.status,u.name""",
            ),
        }


@app.get("/api/audit")
def audit(actor: Actor, offset: Annotated[int, Query(ge=0)] = 0):
    role(actor, *MANAGE)
    with db.connect() as conn:
        return many(
            conn,
            "SELECT * FROM events ORDER BY id DESC LIMIT 100 OFFSET :offset",
            offset=offset,
        )


@app.put("/api/lab/clock")
def clock(payload: c.Clock, actor: Actor, request: Request):
    role(actor, "ADMIN")
    if os.getenv("LAB_MODE") != "1":
        raise HTTPException(403, "LAB_DISABLED")
    with db.begin() as conn:
        result = one(
            conn,
            """UPDATE settings SET offset_seconds=offset_seconds+:seconds,
                         fault=COALESCE(:fault,fault) WHERE id RETURNING offset_seconds,fault""",
            **payload.model_dump(),
        )
        history(conn, None, request.state.id, actor["id"], "LAB_CLOCK", **result)
        return result


@app.post("/api/lab/run/{scenario}")
def experiment(scenario: Scenario, actor: Actor):
    role(actor, "ADMIN")
    if os.getenv("LAB_MODE") != "1":
        raise HTTPException(403, "LAB_DISABLED")
    # A dedicated lock keeps the synthetic clock and fault switch deterministic across runs.
    with db.begin() as conn:
        if not sql(conn, "SELECT pg_try_advisory_xact_lock(771201)").scalar_one():
            raise HTTPException(409, "LAB_BUSY")
        try:
            return run(scenario)
        except (RuntimeError, StopIteration) as error:
            raise HTTPException(
                500, {"code": "LAB_FAILED", "message": str(error)}
            ) from error
