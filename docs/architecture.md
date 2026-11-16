# Architecture / Архитектура

[Analysis and use cases](analysis.md) · [Requirements evidence](verification.md)

## Model-to-runtime path

An analyst imports or edits BPMN in bpmn-js. Publication compiles that XML to a validated graph and keeps both representations in PostgreSQL. An instance references a single version. Each token reads the graph for its pinned version. The sample flows are standard BPMN XML with diagram interchange geometry and a Flowent JSON document for executable configuration.

- [Expense Approval](processes/expense.bpmn)
- [IT Access Request](processes/access.bpmn)
- [Business Travel Approval](processes/travel.bpmn)

The Workbench associates a successful check with the SHA-256 of the exact XML. On publication the API locks the definition, verifies the submitted revision and digest when supplied, and compiles the same persisted draft in that transaction. Legacy callers that submit only the revision still receive the locked compilation. The runtime model screen uses the instance's existing data-access check and the pinned XML returned by that endpoint.

The incident API distinguishes pending work, confirmed completion and a subsequent incident. It reads the existing job and its event history. New service events carry the job ID, so a retry and its eventual outcome can be grouped without inferring success from queue acceptance.

## Execution and durable work

| Construct | Behavior |
| --- | --- |
| None Start Event | Create the first token and follow the only outgoing sequence flow |
| None End Event | End the arriving token. Complete the instance after the last active token |
| User Task | Persist an eligible task and wait for a valid completion by its assignee |
| Service Task | Queue an allowlisted transactional action, retry or expose an incident |
| Exclusive Gateway | Evaluate typed predicates in XML flow order and take the configured default if none matches |
| Parallel Gateway | Create branch tokens and merge arrivals for the same split activation |
| Intermediate Timer Catch Event | Persist a due time, advance the token when the worker processes the job |
| Sequence Flow and BPMN DI | Resolve graph edges and render geometry |

PostgreSQL is the source of truth. FastAPI and the worker call the same application engine. Row locks on the instance serialize competing transitions. The worker rechecks the job after acquiring the instance lock. Command receipts bind actor, operation, key and payload. Version rows are protected by a PostgreSQL trigger. Every durable handoff uses the same transaction as its source transition.

## Security boundaries

The browser holds a bearer token in memory for the current page lifetime. PostgreSQL holds only a digest with expiry. Passwords use a salted password derivation function. API roles and group membership are checked on the server, including access to instances. Production use would require TLS, credential provisioning and rotation, authentication rate limits, retention policies and operational monitoring. The lab runs on loopback and uses separate data. Its time offset, error injection and short-lived scenario sessions exist only in that environment.

Models pass local BPMN XSD and separate semantic validation. XML external resolution is disabled. User forms and rule expressions use allowlisted types and operators. Service actions have no network or script execution capability. Requests that change state record a correlation identifier in the event history. See [role and transition rules](model.md).

## Reproducible diagrams

- [C4 context](diagrams/context.mmd)
- [C4 containers](diagrams/containers.mmd)
- [Runtime ERD](diagrams/runtime.mmd)
- [Parallel join sequence](diagrams/join.mmd)
- [Publication sequence](diagrams/publish.mmd)
- [Task completion sequence](diagrams/task-sequence.mmd)
- [Task states](diagrams/task-state.mmd)
- [Instance states](diagrams/instance-state.mmd)
- [Token states](diagrams/token.mmd)

The vendored schemas come from [OMG BPMN 2.0.2](https://www.omg.org/spec/BPMN/2.0.2/About-BPMN). The interactive editor uses [bpmn-js](https://github.com/bpmn-io/bpmn-js) under its upstream license. The built application preserves the bpmn.io attribution.
