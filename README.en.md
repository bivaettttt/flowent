# Flowent

[Русский](README.ru.md) · [English](README.en.md)

Flowent is an educational workflow platform for approvals. An analyst edits BPMN 2.0 XML, validates it, and publishes an immutable version. The engine executes that version and stores tasks, token transitions, timers, and incidents in PostgreSQL. Existing instances keep their original definition when a new version is published.

## Run locally

```sh
docker compose up --build --wait
```

Open the [workspace](http://127.0.0.1:8120). Compose binds the demo to loopback, applies database migrations and seeds synthetic data idempotently. Set `FLOWENT_PORT` or `FLOWENT_DEMO_PASSWORD` to change the local port or initial seed password. Seeded accounts use `Flowent-demo-local` by default.

| Username | Workflow |
| --- | --- |
| `employee` | Start and track your own requests |
| `analyst` | Open the BPMN modeler, validate and publish a model |
| `manager` | Complete manager reviews |
| `approver`, `finance`, `security`, `it` | Complete tasks assigned to the corresponding group |
| `admin` | Inspect incidents, reports, users, and Lab |

The reliability lab uses a separate Compose project and PostgreSQL volume.

```sh
scripts/lab up
```

Open [Flowent Lab](http://127.0.0.1:8121) as `admin`. Use `scripts/lab stop` to stop the environment and `scripts/lab reset` to recreate it from scratch.

## Demonstration workflows

- Expense approval routes requests based on amount.
- IT access approval runs IT and security reviews in parallel. The task after the join appears after both reviews finish.
- Business travel approval can return a request for revision and route it back to the manager.
- Lab shows real HTTP responses, instance snapshots and event history.

See the [walkthrough and captures](docs/demo.md).

## Architecture and API

React and bpmn-js call FastAPI through nginx. PostgreSQL stores definitions, versions, instances, tokens, human tasks, command receipts, and audit events. A separate worker polls for due jobs and processes timers, SLA deadlines and service tasks. Browser sessions use bearer tokens held in memory for the lifetime of the page.

The executable subset supports None Start/End Events, User and Service Tasks, Exclusive Gateways, structured Parallel Gateways, and intermediate Timer Catch Events. BPMN XML carries conditions and field definitions. Service actions come from a fixed allowlist.

- [Domain model, requirements and access](docs/model.md)
- [Architecture and BPMN execution](docs/architecture.md)
- [OpenAPI contract](docs/openapi.json)
- [Verification and traceability](docs/verification.md)
- [Status and limitations](docs/PROJECT_STATUS.md)

`backend/` holds the API, migrations and engine, `frontend/` holds the workspace and browser tests, `scripts/` holds the local verification commands, `docs/` holds BPMN, contracts and analysis, and `assets/` holds captures from the running application.

## Workflow and security

Edit the graph or element properties in the modeler. Validation checks XML integrity and executable semantics. A manager publishes the saved draft. Assignees claim eligible tasks and submit forms pinned to the deployed version. The monitor shows current tokens, completed nodes and service failures. After attempts are exhausted, an administrator can requeue the job with a reason.

The stack includes Python, FastAPI, SQLAlchemy, Alembic, PostgreSQL, TypeScript, React, Vite, bpmn-js, Docker Compose and Playwright. The interactive contract is available in [local Swagger UI](http://127.0.0.1:8120/api/docs). See the [project status](docs/PROJECT_STATUS.md) for limits and possible extensions. The project source currently has no separate license. Third-party components retain their upstream licenses. [GitHub Actions checks](https://github.com/bivaettttt/flowent/actions).
