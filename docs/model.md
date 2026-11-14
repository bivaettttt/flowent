# Flowent · Анализ и архитектура / Analysis and architecture

Flowent lets analysts model operational approvals and lets managers publish immutable process versions. Employees start requests and complete assigned tasks. Approvers work from groups. Administrators diagnose blocked execution. The synthetic processes cover expenses, IT access and travel.

| ID | Need | Acceptance |
|---|---|---|
| FR-01 | Analyst models and validates a draft | BPMN XML and embedded configuration round trip. Unsupported execution constructs have element-level diagnostics |
| FR-02 | Manager publishes | New instances pin a published version. Historical XML and configuration remain unchanged |
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
