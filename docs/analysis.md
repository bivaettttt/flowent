# Product analysis / Системный анализ

## Business context

BR-001. Approval owners need to change routing independently of application releases and retain an explanation for decisions already taken. BR-002. Operators need to identify whether a process is waiting for people, elapsed time, another branch or service recovery.

| Stakeholder | Work | Acceptance evidence |
| --- | --- | --- |
| Employee | Submit a request and respond to clarification | The instance preserves the entered data and returns a task to its initiator |
| Approver | Handle eligible requests from a shared inbox | Claim and completion expose the current task state and reject a competing completion |
| Analyst | Change and validate a model | Export contains the visual edits. Validation points to a faulty node or XML line |
| Process manager | Publish and observe workflows | Initial and later instances show their own immutable version and route |
| Administrator | Recover service execution and demonstrate failure cases | Recovery records the note and retains the incident and prior attempts |

Scope includes an executable BPMN subset, synthetic approval workflows, publication, work queues and diagnostic history. External identity providers, scheduled messages, subprocesses, business calendars and external delivery are outside the released scope.

| Term | Meaning |
| --- | --- |
| Definition | Stable process code and editable draft |
| Version | Immutable deployed XML and graph |
| Instance | Runtime execution pinned to one version |
| Token | One path of execution, carrying nested parallel context |
| Activation | Unique execution of a parallel split |
| Job | Durable timer or service work waiting for the worker |
| Receipt | Persisted result for a retriable command |
| Incident | Recorded failure after automatic service attempts are exhausted |

## Quality requirements

| ID | Acceptance |
| --- | --- |
| NFR-01 | Committing a transition persists the next task, job or terminal state with the event. A worker stop and API restart preserve outstanding work |
| NFR-02 | A concurrent claim or completion cannot cause duplicate transitions. A join waits for its complete activation set |
| NFR-03 | Every protected resource is checked against an authenticated actor, a server role and ownership or membership where applicable |
| NFR-04 | The HTTP response and corresponding audit record can be correlated with a request identifier |
| NFR-05 | Demo and lab use separate Compose projects and database volumes. A lab reset preserves demo data |

## Use cases and user stories

| ID | Story | Main flow | Alternate flow |
| --- | --- | --- | --- |
| UC-01 | As an analyst, I want deployment to start with validated XML | Edit, save with expected revision, validate, obtain publication by a manager | A stale revision returns 409. Invalid XML identifies the issue and remains a draft |
| UC-02 | As an employee, I want to submit a request and see its state | Select active definition, enter start values, track pinned instance | An invalid field returns 422. An archived definition cannot start new work |
| UC-03 | As an approver, I want to handle my queue safely | Locate task, claim, submit the displayed fields | A wrong actor is denied. The same key and payload return the first response |
| UC-04 | As an administrator, I want to diagnose and retry a blocked job | Open incident, inspect execution, remove fault, provide retry note | A stale retry conflicts. The open incident remains discoverable until explicitly handled |

## API and task rules

Draft revision conflicts and idempotency collisions use 409. Unauthenticated and unauthorized actions use 401 and 403. A resource outside visibility can be hidden with 404. Invalid model or data use 422. Model errors include an element identifier or XML validation line. Task escalation marks an open or claimed task once at its deadline. The worker and reports use persisted UTC time, with an isolated clock offset only for Lab.

Administrator and process manager can monitor cross-user execution. Only roles entitled to claim a task can complete it and only while they are its assignee. Model assignments name a group or the instance initiator. See the [role matrix and routing decisions](model.md), [runtime model](architecture.md), and [requirements evidence](verification.md).
