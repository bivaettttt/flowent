let token = "";
export const session = (value: string) => {
  token = value;
};
export type Problem = {
  code?: string;
  element?: string;
  message?: string;
  issues?: { field: string; rule: string }[];
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string | Problem | undefined,
    public requestId: string | null,
  ) {
    const message =
      typeof detail === "string" ? detail : (detail?.message ?? detail?.code);
    super(
      [message ?? "Не удалось выполнить запрос", "HTTP " + status, requestId]
        .filter(Boolean)
        .join(" · "),
    );
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const headers = {
    Authorization: "Bearer " + token,
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(key ? { "Idempotency-Key": key } : {}),
  };
  const res = await fetch("/api" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => undefined);
  if (!res.ok || data === undefined)
    throw new ApiError(
      res.status,
      data?.detail,
      res.headers.get("X-Request-ID"),
    );
  return data;
}
export type Field = {
  type: "string" | "integer" | "boolean";
  title?: string;
  enum?: string[];
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
};
export type Form = { properties: Record<string, Field>; required?: string[] };
export type User = {
  id: string;
  name: string;
  role: string;
  lab: boolean;
  groups: string[];
};
export type Definition = {
  id: string;
  name: string;
  code: string;
  revision: number;
  number?: number;
  draft: string;
  active_version: string | null;
  updated_at?: string | null;
  current?: { number: number } | null;
  archived: boolean;
  input: Form | null;
  versions: { id: string; number: number; created_at: string }[];
};
export type Task = {
  id: string;
  instance: string;
  node: string;
  name: string;
  process?: string;
  number?: number;
  version?: string;
  definition?: string;
  assignee_name?: string | null;
  input?: unknown;
  started_at?: string | null;
  observed_at?: string;
  completed_at?: string | null;
  submission?: unknown;
  status: string;
  work_group: string;
  assignee: string | null;
  form: Form;
  due_at: string;
  priority: number;
  escalated: boolean;
};
export type Event = {
  id: number;
  action: string;
  instance?: string | null;
  actor?: string | null;
  node: string | null;
  request: string;
  created_at: string;
  detail: unknown;
};
export type Instance = {
  id: string;
  owner: string;
  status: string;
  name: string;
  number: number;
  version: string;
  definition: string;
  active_tasks?: number;
  open_incidents?: number;
  observed_at: string;
  due_at: string;
  created_at: string;
  completed_at: string | null;
  initiator: string;
  xml: string;
  vars: unknown;
  tasks: Task[];
  tokens: {
    id: string;
    node: string;
    status: string;
    stack: { fork: string; branch: string; split: string; join: string }[];
  }[];
  events: Event[];
  jobs: {
    id: string;
    node: string;
    finished_at: string | null;
    kind: string;
    status: string;
    due_at: string;
    attempts: number;
  }[];
};
export type Row = Record<string, string | number | boolean | null>;
