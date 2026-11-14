from alembic import op

revision = "001"
down_revision = None


def upgrade():
    op.execute("""
CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), login text UNIQUE NOT NULL,
 name text NOT NULL, password text NOT NULL, role text NOT NULL CHECK(role IN
 ('PROCESS_ANALYST','PROCESS_MANAGER','EMPLOYEE','APPROVER','ADMIN')), groups text[] NOT NULL DEFAULT '{}');
CREATE TABLE sessions(digest text PRIMARY KEY, actor uuid NOT NULL REFERENCES users, expires timestamptz NOT NULL);
CREATE TABLE definitions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL,
 name text NOT NULL, owner uuid NOT NULL REFERENCES users, archived boolean NOT NULL DEFAULT false,
 draft text NOT NULL, revision int NOT NULL DEFAULT 1, active_version uuid);
CREATE TABLE versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), definition uuid NOT NULL REFERENCES definitions,
 number int NOT NULL, xml text NOT NULL, model jsonb NOT NULL, actor uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(definition,number), UNIQUE(definition,id));
ALTER TABLE definitions ADD FOREIGN KEY(id,active_version) REFERENCES versions(definition,id);
CREATE TABLE instances(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version uuid NOT NULL REFERENCES versions,
 owner uuid NOT NULL REFERENCES users, vars jsonb NOT NULL, status text NOT NULL DEFAULT 'RUNNING'
 CHECK(status IN ('RUNNING','COMPLETED','INCIDENT')), created_at timestamptz NOT NULL,
 due_at timestamptz NOT NULL, completed_at timestamptz);
CREATE TABLE tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), instance uuid NOT NULL REFERENCES instances,
 node text NOT NULL, stack jsonb NOT NULL, status text NOT NULL CHECK(status IN
 ('READY','TASK','TIMER','SERVICE','JOIN','DONE')));
CREATE INDEX token_instance ON tokens(instance,status);
CREATE TABLE joins(instance uuid REFERENCES instances, fork uuid, branch text, token uuid NOT NULL REFERENCES tokens,
 PRIMARY KEY(instance,fork,branch));
CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), instance uuid NOT NULL REFERENCES instances,
 token uuid UNIQUE NOT NULL REFERENCES tokens, node text NOT NULL, name text NOT NULL, work_group text NOT NULL,
 assignee uuid REFERENCES users, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLAIMED','DONE')),
 form jsonb NOT NULL, submission jsonb, priority int NOT NULL, due_at timestamptz NOT NULL,
 completed_at timestamptz, escalated boolean NOT NULL DEFAULT false);
CREATE INDEX task_inbox ON tasks(work_group,status,due_at);
CREATE TABLE jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), instance uuid NOT NULL REFERENCES instances,
 token uuid UNIQUE NOT NULL REFERENCES tokens, kind text NOT NULL CHECK(kind IN ('TIMER','SERVICE')),
 due_at timestamptz NOT NULL, attempts int NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'WAITING'
 CHECK(status IN ('WAITING','DONE','BLOCKED')), error text);
CREATE INDEX due_jobs ON jobs(due_at) WHERE status='WAITING';
CREATE TABLE incidents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job uuid NOT NULL REFERENCES jobs,
 instance uuid NOT NULL REFERENCES instances, code text NOT NULL, opened timestamptz NOT NULL,
 resolved timestamptz, note text);
CREATE UNIQUE INDEX open_incident ON incidents(job) WHERE resolved IS NULL;
CREATE TABLE events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, instance uuid REFERENCES instances,
 actor uuid REFERENCES users, request uuid NOT NULL, action text NOT NULL, node text, detail jsonb NOT NULL,
 created_at timestamptz NOT NULL);
CREATE INDEX events_instance ON events(instance,id);
CREATE TABLE receipts(actor uuid REFERENCES users, key text, digest text NOT NULL,
 response jsonb NOT NULL, PRIMARY KEY(actor,key));
CREATE TABLE settings(id bool PRIMARY KEY CHECK(id), offset_seconds bigint NOT NULL DEFAULT 0,
 fault boolean NOT NULL DEFAULT false);
INSERT INTO settings(id) VALUES(true);
CREATE FUNCTION immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable history' USING ERRCODE='23514'; END $$;
CREATE TRIGGER preserve_versions BEFORE UPDATE OR DELETE ON versions FOR EACH ROW EXECUTE FUNCTION immutable();
CREATE TRIGGER preserve_events BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION immutable();
""")


def downgrade():
    op.execute(
        "DROP TABLE settings,receipts,events,incidents,jobs,tasks,joins,tokens,instances,versions,definitions,sessions,users CASCADE"
    )
    op.execute("DROP FUNCTION immutable()")
