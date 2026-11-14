# Verification / Проверки

All runtime checks use HTTP against FastAPI and PostgreSQL. The browser tests drive Chromium against the Compose workspace. The laboratory uses its own database volume and synthetic accounts.

## Run

```sh
python -m pip install -r backend/requirements.txt pytest ruff
ruff check backend scripts tests
ruff format --check backend scripts tests
pytest -q
PYTHONPATH=backend python scripts/openapi.py --check
PYTHONPATH=backend python scripts/verify_repo.py

scripts/lab up
docker compose -p flowent-lab exec -T api python - < scripts/verify.py
docker compose -p flowent-lab exec -T api python - < scripts/verify-lab.py
scripts/restart-check

cd frontend
npm ci
npm run format
npm run build
npx playwright install chromium
npm run e2e
```

Run the scenario suites sequentially. Each uses shared simulation time in the lab database. The reset command recreates the lab volume. The normal workspace is separate.

## Traceability

| Requirement | Rule or invariant | Implementation | Automated evidence |
| --- | --- | --- | --- |
| FR-01 · Model | BR-01 · XSD plus executable subset | [Compiler](../backend/flowent/model.py), [editor](../frontend/src/modeler.tsx) | TC-01 · [Unit tests](../tests/test_model.py), TC-08 · [Browser flow](../frontend/e2e/flow.spec.ts) |
| FR-02 · Publication | BR-02 · Versions are append-only and pinned on start | [Publication](../backend/flowent/operations.py), [migration](../backend/migrations/versions/001_engine.py) | TC-02 · [Integration](../scripts/verify.py) verifies direct mutation rejection and version pinning |
| FR-03 · Tasks | BR-03 · Valid completion requires the assigned actor and the deployed form | [Access](../backend/flowent/access.py), [operations](../backend/flowent/operations.py) | TC-03 · [Integration](../scripts/verify.py) exercises foreign access, wrong role, form rejection and replay |
| FR-04 · Routing | BR-04 · XOR chooses one path and a join advances once after every branch of the same split | [Engine](../backend/flowent/engine.py) | TC-04 · [Integration](../scripts/verify.py) checks the default, a genuine join wait and concurrent branch completion |
| FR-05 · Continuity | BR-05 · A due job remains durable and retry retains incident history | [Worker](../backend/flowent/worker.py), [engine](../backend/flowent/engine.py) | TC-05 · [Integration](../scripts/verify.py) and [restart check](../scripts/restart-check) |
| FR-06 · Monitoring | BR-06 · View and SLA derive from execution events, deadlines and tokens | [API](openapi.json), [workspace](../frontend/src/main.tsx) | TC-06 · [Integration](../scripts/verify.py) and [browser flow](../frontend/e2e/flow.spec.ts) |
| FR-07 · Lab | BR-07 · Only an administrator in the isolated environment can run scenarios | [Lab](../backend/flowent/lab.py), [launcher](../scripts/lab) | TC-07 · [Scenario verification](../scripts/verify-lab.py), TC-08 · [Browser flow](../frontend/e2e/flow.spec.ts) |

Local PostgreSQL verification covered expense routing, IT access and travel, revision and rejection, scoped access, form errors, parallel join and concurrent completion, idempotent replay, timer and SLA work, service failure and recovery, immutable publication and version pinning. The standalone restart check stops the worker with a pending timer, restarts the API, starts the worker, then checks that the saved timer fired exactly once. The scenario suite evaluates fourteen Lab checks. See [status](PROJECT_STATUS.md) for the release verification record.
