# Flowent · Анализ и архитектура / Analysis and architecture

Flowent lets analysts model operational approvals and lets managers publish immutable process versions. Employees start requests and complete assigned tasks. Approvers work from groups. Administrators diagnose blocked execution. The synthetic processes cover expenses, IT access and travel.

| ID | Need | Acceptance |
|---|---|---|
| FR-01 | Analyst models and validates a draft | BPMN XML and embedded configuration round trip. Unsupported execution constructs have element-level diagnostics |
| FR-02 | Manager or administrator publishes | New instances pin a published version. Historical XML and configuration remain unchanged |
| FR-03 | Authorized user completes work | Claim and completion check role and group. Server validates the pinned form |
| FR-04 | Engine executes selected routes | Exclusive gates use typed decision tables. A parallel join receives every paired branch exactly once |
| FR-05 | Worker resumes after restarts | Timer and service work persist in PostgreSQL. Retry and incidents remain observable |
| FR-06 | Manager investigates | Instance view shows active nodes, event history, SLA and actual counts |
| FR-07 | Operator reproduces behavior | Separate Compose project and volume isolate laboratory records |

## Execution contract

The subset uses BPMN 2.0.2 XML: none start/end, user and service tasks, sequence flows, exclusive and parallel gateways and intermediate duration timer catches. One executable process, one start, reachable endpoints, unique IDs. XOR splits require a default and field-based typed predicates on other flows. Ordered first match wins in the process's XML sequence-flow order. XOR merges are pass-through. AND gateways use a structured, explicitly paired split and join. Every branch must reach that join, and no branch may enter a sibling. Nested forks are supported by a stack of fork IDs and branch IDs. Arbitrary cycles are excluded. A loop through a user task is allowed outside parallel regions. Each execution transaction caps synchronous steps.

Flowent configuration travels in process-level BPMN documentation using a JSON object. It defines start and task form schemas, groups, SLA, service actions and gateway decisions keyed by BPMN identifiers. No scripts, code evaluation, network destinations or arbitrary expressions are executed. A form writes values under an input or task-node scope, so parallel branches cannot overwrite each other's outputs.

## Consistency and operations

One transaction per command. The instance row serializes transitions; concurrent completions may wait for each other. A receipt binds a request, actor and key to a result. A join keys arrivals by fork activation and branch, consolidating only the matching set. API and worker share PostgreSQL. Worker takes due jobs with row locking and executes local transactional actions. Retry scheduling, incident state and history commit together. Durations and SLA use UTC elapsed seconds. Lab time is a persisted offset in the isolated database.

**ADR-01.** A relational execution store keeps tasks, timers, events and command receipts atomic. No external broker is required for local transactional actions.
**ADR-02.** Structured AND regions trade BPMN flexibility for statically verifiable branch ownership and predictable joins.
**ADR-03.** Publish copies validated XML and compiled configuration to append-only versions. Instances do not migrate automatically.

[BPMN specification, OMG](https://www.omg.org/spec/BPMN/2.0.2/About-BPMN)

## Roles and transitions

| Actor | Actions |
|---|---|
| Process analyst | Save with expected revision, compile and inspect version history |
| Process manager | Validate, publish, archive, view evidence, reports and incidents |
| Employee | Start a published process, read own instances and claim allowed work |
| Approver | Claim and complete eligible group tasks and inspect their instance context |
| Administrator | Manage fixture users, publish, retry current incidents and run isolated experiments |

Tasks transition OPEN → CLAIMED → DONE. A completion transaction validates the pinned form, stores the submission, emits an event and moves the token. A terminal token stays as history. A process completes when no active token remains. A rejected business path reaches its modeled end event and has execution state COMPLETED. A service job makes up to three attempts with 2^attempt seconds between attempts. Exhaustion creates a visible incident. A retry requires a note and keeps the old incident row. The worker picks due jobs, locks the instance before the job, and verifies the job is still eligible. A second worker observing the same job can safely wait and recheck. Task escalation marks a deadline breach once and emits a durable event. Group reassignment and external notifications are future extensions.

[Context](diagrams/context.mmd) · [Containers](diagrams/containers.mmd) · [ERD](diagrams/runtime.mmd) · [Join sequence](diagrams/join.mmd) · [Token states](diagrams/token.mmd)

## Decision tables

| Model | Conditional fork | Default | Completion work |
|---|---|---|---|
| EXPENSE | amount ≥ 100000 RUB: lead approver + finance | Manager | Employee confirms expense |
| ACCESS | privileged = true: lead approver + security | Manager | IT grants access |
| TRAVEL | budget > 80000 RUB: lead approver + finance | Manager | Employee confirms travel |

The account `manager` publishes definitions. The account `approver` works on approval tasks in the `managers` group. Each approval can approve, reject or request clarification. In a parallel case both branches reach the join before decisions are evaluated. A reject or clarification goes to its modeled path, with the lead approver evaluated first. Clarification loops through a user task, outside the structured parallel region. Approval waits five seconds and executes the configured local service before opening completion work.

## Interfaces and metrics

Use POST /api/auth/login, then send the bearer token. Start, publish, claim, complete and incident retry require Idempotency-Key. 401 means missing session, 403 means role denied, 404 means unavailable object, 409 means conflict, and 422 identifies invalid XML or forms. XML errors identify the BPMN node or the XSD line. Registry, instances and inbox paginate at 50 items, audit at 100. [OpenAPI](openapi.json)

The reports count instances by process version and execution state. Mean execution time uses completed instances. A deadline breach compares completion or current time with the instance deadline. Task median and p95 measure completed task duration from its ENTERED event, grouped by assignee and group.
