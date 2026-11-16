# Состояние / Status

Flowent implements a runnable educational approval workspace. Its definition of executable BPMN is documented in [architecture](architecture.md). The scope covers the three seeded processes and the separate PostgreSQL lab.

## Проверка релиза / Release verification

- 15 pytest unit cases exercised schema and model validation, type-aware routing and typed inputs.
- The integration suite passed all three BPMN models against PostgreSQL, including role checks, parallel and concurrent transitions, idempotency, timers, SLA, incident recovery and version pinning.
- The isolated lab verified 14 scenarios over real HTTP and PostgreSQL. Parallel branching and waiting at the join share a scenario. Recovery after a physical restart is verified with `scripts/restart-check`.
- Seven Chromium Playwright cases passed on an isolated PostgreSQL environment. They cover editing and execution, validation and unsaved changes, navigation and pinned versions, branch waiting, timers, SLA, incident history and recovery. The [gallery](demo.md) shows 27 real screenshots. The [redesign record](ux-ui-redesign.md) describes browser checks and acceptance gaps.
- The normal Compose workspace started with three seeded definitions and rejected lab clock changes with HTTP 403.
- The Quality workflow runs on pushes and pull requests. The current run history is available in [GitHub Actions](https://github.com/bivaettttt/flowent/actions).

## Ограничения / Limits

- The compiler runs a documented BPMN subset. Boundary and message events, subprocesses, arbitrary cycles, unstructured parallelism and model migration are outside this implementation.
- The expense route uses amount, the IT route uses the privileged flag, and travel uses the budget threshold. Category and purpose are retained as form data. A financial budget ledger, system sensitivity catalog and travel date-window policy are pending.
- Business rules, assignments and form schemas are edited in the BPMN XML configuration. Dedicated visual rule and form designers and semantic version comparison are pending.
- Task claim uses a combined eligible and assigned inbox. Group identifiers are fixed and self-service reassignment is pending.
- Service notification records a local event. An external delivery adapter and a notification inbox are pending.
- SLA and task performance are available as reports. Notification delivery and business calendars are outside the current SLA implementation.
- The available report shows counts and task-duration percentiles. Dedicated bottleneck detection and richer historical filtering are pending.
- The OpenAPI export is generated from FastAPI. Response bodies for several endpoints still use generic OpenAPI schemas.
- The test suite covers local concurrency and persistence. Load certification and production deployment are outside this project.
