import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./styles.css";
import {
  useEffect,
  useState,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  GitFork,
  LayoutDashboard,
  Box,
  ClipboardList,
  ChartNoAxesCombined,
  TriangleAlert,
  ScrollText,
  FlaskConical,
  Users,
  LogOut,
} from "lucide-react";
import {
  api,
  ApiError,
  session,
  type User,
  type Definition,
  type Task,
  type Instance,
  type Event,
  type Form,
  type Row,
} from "./api";
import { Diagram, type CanvasAPI } from "./modeler";

const defs = "/process-definitions",
  instances = "/process-instances";
const stamp = (s: string) => new Date(s).toLocaleString("ru");
const short = (s: string) => s.slice(0, 8);
const labels: Record<string, string> = {
  RUNNING: "Исполняется",
  COMPLETED: "Завершён",
  INCIDENT: "Инцидент",
  OPEN: "Открыта",
  CLAIMED: "В работе",
  DONE: "Выполнена",
  TASK: "Задача",
  JOIN: "Ожидание веток",
  SERVICE: "Сервис",
  TIMER: "Таймер",
};
function useData<T>(path: string, rev: number) {
  const [state, set] = useState<{ data?: T; error?: Error; loading: boolean }>({
    loading: true,
  });
  useEffect(() => {
    if (!path) return;
    let active = true;
    set((s) => ({ data: s.data, loading: true }));
    api<T>(path).then(
      (data) => {
        if (active) set({ data, loading: false });
      },
      (error) => {
        if (active) set({ error, loading: false });
      },
    );
    return () => {
      active = false;
    };
  }, [path, rev]);
  return state;
}
function useAction(refresh: () => void) {
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  async function call<T>(
    path: string,
    method = "POST",
    body?: unknown,
    critical = false,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    const fingerprint = JSON.stringify([path, method, body]);
    const key = critical
      ? (keys.current.get(fingerprint) ?? crypto.randomUUID())
      : undefined;
    if (key) keys.current.set(fingerprint, key);
    try {
      const result = await api<T>(path, method, body, key);
      keys.current.delete(fingerprint);
      refresh();
      return result;
    } catch (e) {
      setError(e);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { error, busy, call, setError };
}
function Head({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <header className="head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </header>
  );
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <p className="error" role="alert">
      {String(error instanceof Error ? error.message : error)}
    </p>
  ) : null;
}
function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: ReactNode[][];
}) {
  return rows.length ? (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="pad muted">Записей пока нет.</p>
  );
}
function Json({ data }: { data: unknown }) {
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
function Status({ value }: { value: string }) {
  return (
    <span
      className={
        "status " +
        (["DONE", "COMPLETED"].includes(value)
          ? "green"
          : value === "INCIDENT"
            ? "red"
            : "")
      }
    >
      {labels[value] ?? value}
    </span>
  );
}
function fields(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return new FormData(e.currentTarget);
}
function Dynamic({
  form,
  busy,
  submit,
  label,
}: {
  form: Form;
  busy: boolean;
  submit: (v: object) => void;
  label: string;
}) {
  return (
    <form
      className="form pad"
      onSubmit={(e) => {
        const f = fields(e),
          values: Record<string, string | boolean | number> = {};
        for (const [k, p] of Object.entries(form.properties)) {
          const v = f.get(k);
          if (p.type === "boolean") values[k] = v === "on";
          else if (v !== null && String(v) !== "")
            values[k] = p.type === "integer" ? Number(v) : String(v);
        }
        submit(values);
      }}
    >
      {Object.entries(form.properties).map(([k, p]) => (
        <label key={k} className={p.type === "boolean" ? "check" : ""}>
          {p.title ?? k}
          {p.enum ? (
            <select name={k} required={form.required?.includes(k)}>
              <option value="">Выберите</option>
              {p.enum.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          ) : p.type === "boolean" ? (
            <input name={k} type="checkbox" />
          ) : p.description === "multiline" ? (
            <textarea
              name={k}
              required={form.required?.includes(k)}
              minLength={p.minLength}
              maxLength={p.maxLength}
            />
          ) : (
            <input
              name={k}
              type={
                p.type === "integer"
                  ? "number"
                  : p.format === "date"
                    ? "date"
                    : "text"
              }
              required={form.required?.includes(k)}
              min={p.minimum}
              max={p.maximum}
              minLength={p.minLength}
              maxLength={p.maxLength}
            />
          )}
        </label>
      ))}
      <button className="primary" disabled={busy}>
        {label}
      </button>
    </form>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span>
        <GitFork size={22} />
      </span>
      Flowent
    </div>
  );
}
function Login({ done }: { done: (u: User) => void }) {
  const act = useAction(() => {});
  return (
    <main className="login">
      <section>
        <Brand />
        <h1>Вход в Flowent</h1>
        <p>Моделирование и исполнение процессов</p>
        <form
          className="form"
          onSubmit={(e) => {
            const body = Object.fromEntries(fields(e));
            void act
              .call<{ token: string }>("/auth/login", "POST", body)
              .then(async (value) => {
                if (value) {
                  session(value.token);
                  done(await api<User>("/me"));
                }
              })
              .catch(act.setError);
          }}
        >
          <label>
            Логин
            <input name="login" required autoComplete="username" />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <ErrorBox error={act.error} />
          <button className="primary" disabled={act.busy}>
            Войти
          </button>
        </form>
      </section>
    </main>
  );
}
function Workspace() {
  const [user, setUser] = useState<User | null>(null);
  const [route, setRoute] = useState(
    () => location.hash.slice(1) || "registry",
  );
  const [rev, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  const act = useAction(refresh);
  const currentRoute = useRef(route);
  const leaveGuard = useRef<(() => Promise<boolean>) | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  function navigate(next: string) {
    currentRoute.current = next;
    if (location.hash.slice(1) !== next) location.hash = next;
    setRoute(next);
  }
  useEffect(() => {
    const change = () => {
      const next = location.hash.slice(1) || "registry";
      if (next === currentRoute.current) return;
      if (leaveGuard.current) {
        history.replaceState(history.state, "", "#" + currentRoute.current);
        setDestination(next);
        return;
      }
      currentRoute.current = next;
      setRoute(next);
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (leaveGuard.current) {
        event.preventDefault();
        event.returnValue = true;
      }
    };
    window.addEventListener("hashchange", change);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  useEffect(() => {
    if (destination !== null) dialog.current?.showModal();
    else dialog.current?.close();
  }, [destination]);
  function logout() {
    void api("/auth/logout", "POST")
      .then(() => {
        session("");
        setUser(null);
      })
      .catch(act.setError);
  }
  function acceptLeave(next: string) {
    leaveGuard.current = null;
    setDestination(null);
    if (next === "logout") logout();
    else navigate(next);
  }
  if (!user) return <Login done={setUser} />;
  const staff = ["PROCESS_MANAGER", "ADMIN"].includes(user.role),
    work = ["EMPLOYEE", "APPROVER"].includes(user.role);
  const items = [
    { path: "overview", title: "Обзор", Icon: LayoutDashboard },
    { path: "registry", title: "Процессы", Icon: GitFork },
    { path: "instances", title: "Экземпляры", Icon: Box },
    ...(work ? [{ path: "tasks", title: "Задачи", Icon: ClipboardList }] : []),
    ...(staff
      ? [
          { path: "reports", title: "Отчёты SLA", Icon: ChartNoAxesCombined },
          { path: "incidents", title: "Инциденты", Icon: TriangleAlert },
          { path: "audit", title: "Аудит", Icon: ScrollText },
        ]
      : []),
    ...(user.role === "ADMIN"
      ? [{ path: "users", title: "Участники", Icon: Users }]
      : []),
    ...(user.lab
      ? [{ path: "lab", title: "Лаборатория", Icon: FlaskConical }]
      : []),
  ];
  const [page, id] = route.split("/");
  const props = { rev, refresh, user };
  return (
    <div
      className="shell"
      onClickCapture={(event) => {
        if (
          !leaveGuard.current ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey
        )
          return;
        const anchor = (event.target as Element).closest("a[href^='#']");
        const next = anchor?.getAttribute("href")?.slice(1);
        if (next && next !== currentRoute.current) {
          event.preventDefault();
          setDestination(next);
        }
      }}
    >
      <dialog
        ref={dialog}
        aria-labelledby="leave-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!leaveBusy) setDestination(null);
        }}
      >
        <h2 id="leave-title">Несохранённые изменения</h2>
        <p>Сохраните черновик или подтвердите выход без сохранения.</p>
        <div className="toolbar">
          <button
            autoFocus
            disabled={leaveBusy}
            onClick={() => setDestination(null)}
          >
            Остаться в редакторе
          </button>
          <button
            disabled={leaveBusy}
            onClick={() => {
              if (destination !== null) acceptLeave(destination);
            }}
          >
            Выйти без сохранения
          </button>
          <button
            className="primary"
            disabled={leaveBusy}
            onClick={() => {
              if (destination === null || leaveBusy) return;
              setLeaveBusy(true);
              void leaveGuard
                .current?.()
                .then((saved) => {
                  if (saved) acceptLeave(destination);
                  else setDestination(null);
                })
                .finally(() => setLeaveBusy(false));
            }}
          >
            Сохранить и выйти
          </button>
        </div>
      </dialog>
      <aside>
        <Brand />
        <nav aria-label="Разделы">
          {items.map(({ path, title, Icon }) => (
            <a
              key={path}
              href={"#" + path}
              className={page === path ? "active" : ""}
            >
              <Icon size={17} />
              {title}
            </a>
          ))}
        </nav>
        <footer>
          {user.lab ? "Изолированная лаборатория" : "Рабочая область"}
        </footer>
      </aside>
      <div className="workspace">
        <div className="top">
          <span>{user.role}</span>
          <div>
            {user.name}
            <button
              aria-label="Выйти"
              onClick={() =>
                leaveGuard.current ? setDestination("logout") : logout()
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
        <main>
          <ErrorBox error={act.error} />
          {page === "overview" ? (
            <Overview rev={rev} staff={staff} work={work} />
          ) : page === "registry" ? (
            id ? (
              <Editor key={id} id={id} {...props} leaveGuard={leaveGuard} />
            ) : (
              <Registry {...props} />
            )
          ) : page === "instances" ? (
            id ? (
              <Monitor key={id} id={id} {...props} />
            ) : (
              <Instances {...props} />
            )
          ) : page === "tasks" && work ? (
            id ? (
              <TaskView key={id} id={id} {...props} />
            ) : (
              <Inbox {...props} />
            )
          ) : page === "reports" && staff ? (
            <Reports rev={rev} />
          ) : page === "incidents" && staff ? (
            <Incidents {...props} />
          ) : page === "audit" && staff ? (
            <Audit rev={rev} />
          ) : page === "users" && user.role === "ADMIN" ? (
            <UsersPage {...props} />
          ) : page === "lab" && user.lab ? (
            <Lab {...props} />
          ) : (
            <Head title="Раздел недоступен" />
          )}
        </main>
      </div>
    </div>
  );
}
type Props = { rev: number; refresh: () => void; user: User };
function Registry({ rev, refresh, user }: Props) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const data = useData<Definition[]>(defs + "?offset=" + offset + query, rev);
  const act = useAction(refresh);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Head
        title="Реестр процессов"
        sub="Модели BPMN, версии и доступные запуски"
      >
        {["PROCESS_ANALYST", "ADMIN"].includes(user.role) && (
          <button className="primary" onClick={() => setOpen(!open)}>
            Новый процесс
          </button>
        )}
      </Head>
      <ErrorBox error={data.error ?? act.error} />
      {open && (
        <Panel title="Черновик из BPMN XML">
          <form
            className="form pad"
            onSubmit={(e) =>
              void act
                .call<Definition>(defs, "POST", Object.fromEntries(fields(e)))
                .then((r) => {
                  if (r) location.hash = "registry/" + r.id;
                })
            }
          >
            <label>
              Код
              <input name="code" required />
            </label>
            <label>
              Название
              <input name="name" required />
            </label>
            <label>
              BPMN XML
              <textarea name="xml" required rows={8} />
            </label>
            <button className="primary" disabled={act.busy}>
              Создать черновик
            </button>
          </form>
        </Panel>
      )}
      <Panel title="Процессы">
        <form
          className="toolbar pad"
          onSubmit={(e) => {
            const data = fields(e);
            setQuery(
              "&q=" +
                encodeURIComponent(String(data.get("q"))) +
                "&archived=" +
                (data.get("archived") === "on"),
            );
            setOffset(0);
          }}
        >
          <label>
            Поиск
            <input name="q" />
          </label>
          {!["EMPLOYEE", "APPROVER"].includes(user.role) && (
            <label className="check">
              Архив
              <input name="archived" type="checkbox" />
            </label>
          )}
          <button>Найти</button>
        </form>
        {data.loading && !data.data ? (
          <p className="pad">Загрузка…</p>
        ) : (
          <DataTable
            columns={["Код", "Процесс", "Версия", "Статус"]}
            rows={(data.data ?? []).map((d) => [
              <code>{d.code}</code>,
              <a href={"#registry/" + d.id}>{d.name}</a>,
              d.number ? "v" + d.number : "—",
              d.archived
                ? "Архив"
                : d.active_version
                  ? "Опубликован"
                  : "Черновик",
            ])}
          />
        )}
        <div className="toolbar pad">
          <button disabled={!offset} onClick={() => setOffset(offset - 50)}>
            Назад
          </button>
          <button
            disabled={(data.data?.length ?? 0) < 50}
            onClick={() => setOffset(offset + 50)}
          >
            Далее
          </button>
        </div>
      </Panel>
    </>
  );
}
type Validation = {
  xml: string;
  result: { valid: boolean; nodes: number; flows: number; digest: string };
};
function Editor({
  id,
  rev,
  refresh,
  user,
  leaveGuard,
}: Props & {
  id: string;
  leaveGuard: { current: (() => Promise<boolean>) | null };
}) {
  const path = defs + "/" + id;
  const data = useData<Definition>(path, rev);
  const d = data.data;
  const act = useAction(refresh);
  const [override, setOverride] = useState<string | null>(null);
  const [validation, setValidation] = useState<Validation>();
  const [dirty, setDirty] = useState(false);
  const epoch = useRef(0);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<unknown>();
  const [version, setVersion] = useState<Definition["versions"][number] | null>(
    null,
  );
  const [raw, setRaw] = useState<string | null>(null);
  const canvas = useRef<CanvasAPI | null>(null);
  const edit =
    ["PROCESS_ANALYST", "ADMIN"].includes(user.role) &&
    !version &&
    !d?.archived;
  function changed() {
    epoch.current++;
    setDirty(true);
    setValidation(undefined);
    setValidationError(undefined);
  }
  async function xml() {
    if (raw !== null) return raw;
    if (canvas.current) {
      const value = await canvas.current.saveXML({ format: true });
      if (value.xml) return value.xml;
    }
    return override ?? d?.draft ?? "";
  }
  async function saveDraft() {
    if (!d || !edit || act.busy) return false;
    try {
      const revision = epoch.current;
      const contents = await xml();
      if (epoch.current !== revision) return false;
      const result = await act.call<Definition>(path, "PUT", {
        name: d.name,
        xml: contents,
        revision: d.revision,
      });
      if (!result || epoch.current !== revision) return false;
      setDirty(false);
      setOverride(contents);
      setRaw(null);
      return true;
    } catch (error) {
      act.setError(error);
      return false;
    }
  }
  useEffect(() => {
    leaveGuard.current = dirty ? saveDraft : null;
    return () => {
      leaveGuard.current = null;
    };
  });
  async function validateDraft() {
    if (!d || validating || act.busy) return;
    const start = epoch.current;
    setValidating(true);
    setValidation(undefined);
    setValidationError(undefined);
    try {
      const contents = dirty ? await xml() : (override ?? d.draft);
      if (start !== epoch.current) return;
      const result = await api<Validation["result"]>("/validate", "POST", {
        name: d.name,
        xml: contents,
        revision: d.revision,
      });
      if (result && start === epoch.current)
        setValidation({ xml: contents, result });
    } catch (error) {
      if (start === epoch.current) setValidationError(error);
    } finally {
      setValidating(false);
    }
  }
  useEffect(() => {
    if (!dirty && !version && override === d?.draft) setOverride(null);
  }, [dirty, version, override, d?.draft]);
  if (!d)
    return (
      <>
        <ErrorBox error={data.error} />
        {data.loading && <p>Загрузка…</p>}
      </>
    );
  return (
    <>
      <a href="#registry">← Реестр</a>
      <Head
        title={d.name}
        sub={[
          d.code,
          version
            ? "Версия " + version.number
            : edit
              ? "Черновик · редакция " + d.revision
              : null,
          !version && d.current
            ? "Опубликована версия " + d.current.number
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <ErrorBox error={act.error ?? data.error} />
      <Panel title="Модель BPMN">
        <div inert={act.busy && !validating}>
          <Diagram
            xml={override ?? d.draft}
            edit={edit}
            changed={changed}
            ready={(value) => {
              canvas.current = value;
            }}
          />
        </div>
        <div className="pad toolbar">
          <button
            onClick={() =>
              void xml()
                .then((contents) => {
                  const url = URL.createObjectURL(
                    new Blob([contents], { type: "application/xml" }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = d.code + ".bpmn";
                  a.click();
                  URL.revokeObjectURL(url);
                })
                .catch(act.setError)
            }
          >
            Экспорт XML
          </button>
          {edit && (
            <>
              <label className="diagram-import">
                <span>Импорт XML</span>
                <input
                  type="file"
                  accept=".bpmn,.xml"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (
                      file &&
                      (!dirty ||
                        window.confirm(
                          "Заменить несохранённую модель импортированным XML?",
                        ))
                    )
                      void file.text().then((v) => {
                        canvas.current = null;
                        setOverride(v);
                        setRaw(null);
                        changed();
                      });
                  }}
                />
              </label>
              <button
                onClick={() => void xml().then(setRaw).catch(act.setError)}
              >
                Править XML и конфигурацию
              </button>
              <button
                className="primary"
                disabled={act.busy}
                onClick={() => void saveDraft()}
              >
                Сохранить черновик
              </button>
            </>
          )}
          {["PROCESS_ANALYST", "PROCESS_MANAGER", "ADMIN"].includes(
            user.role,
          ) && (
            <button
              disabled={act.busy || validating}
              onClick={() => void validateDraft()}
            >
              Проверить модель
            </button>
          )}
          {["PROCESS_MANAGER", "ADMIN"].includes(user.role) && !version && (
            <>
              <button
                className="primary"
                disabled={
                  act.busy || d.archived || dirty || validation?.xml !== d.draft
                }
                onClick={() =>
                  void act.call(
                    path + "/publish",
                    "POST",
                    {
                      revision: d.revision,
                      validated_digest: validation?.result.digest,
                    },
                    true,
                  )
                }
              >
                Опубликовать сохранённое
              </button>
              <button
                disabled={act.busy}
                onClick={() =>
                  void act.call(path + "/archive", "POST", {
                    revision: d.revision,
                    archived: !d.archived,
                  })
                }
              >
                {d.archived ? "Восстановить" : "Архивировать"}
              </button>
            </>
          )}
        </div>
        <div className="pad" role="status">
          {validating ? (
            "Модель проверяется…"
          ) : validationError ? (
            "Модель требует исправления"
          ) : validation ? (
            <>
              Модель прошла проверку · {validation.result.nodes} узлов /{" "}
              {validation.result.flows} связей
            </>
          ) : dirty ? (
            "Несохранённые изменения · требуется проверка"
          ) : (
            "Проверьте текущую модель перед публикацией."
          )}
          {dirty && validation && (
            <p>Изменения проверены. Сохраните черновик перед публикацией.</p>
          )}
        </div>
        {validationError instanceof ApiError &&
        typeof validationError.detail === "object" ? (
          <div className="error pad" role="alert">
            <strong>Ошибка проверки модели</strong>
            <p>
              {validationError.detail.message ?? validationError.detail.code}
            </p>
            {validationError.detail.element && (
              <p>
                Элемент · <code>{validationError.detail.element}</code>
              </p>
            )}
            <p>Публикация заблокирована до успешной проверки.</p>
          </div>
        ) : (
          <ErrorBox error={validationError} />
        )}
      </Panel>
      {raw !== null && edit && (
        <Panel title="XML · формы, назначения, условия и таймеры">
          <div className="pad form wide">
            <p>
              Разрешены Start/End, User/Service Task, Exclusive/Parallel Gateway
              и Timer Catch. Настройки находятся в JSON внутри documentation.
            </p>
            <label>
              Исходник BPMN
              <textarea
                rows={16}
                value={raw}
                disabled={act.busy}
                onChange={(e) => {
                  setRaw(e.target.value);
                  changed();
                }}
              />
            </label>
            <button
              onClick={() => {
                canvas.current = null;
                setOverride(raw);
                setRaw(null);
                changed();
              }}
            >
              Загрузить на холст
            </button>
          </div>
        </Panel>
      )}
      {d.versions.length > 0 && (
        <Panel title="Публикации">
          <DataTable
            columns={["Версия", "Создана", "Просмотр"]}
            rows={d.versions.map((v) => [
              v.number,
              stamp(v.created_at),
              <button
                disabled={dirty}
                onClick={() =>
                  void act
                    .call<{ xml: string }>(path + "/versions/" + v.id, "GET")
                    .then((item) => {
                      if (item) {
                        canvas.current = null;
                        setOverride(item.xml);
                        setVersion(v);
                        setValidation(undefined);
                      }
                    })
                }
              >
                Открыть XML
              </button>,
            ])}
          />
          {version && (
            <div className="pad">
              <button
                onClick={() => {
                  canvas.current = null;
                  setVersion(null);
                  setOverride(null);
                }}
              >
                Вернуться в черновик
              </button>
            </div>
          )}
        </Panel>
      )}
      {user.role === "EMPLOYEE" && d.input && (
        <Panel title="Запустить экземпляр">
          <Dynamic
            form={d.input}
            busy={act.busy}
            label="Запустить процесс"
            submit={(values) =>
              void act
                .call<Instance>(path + "/start", "POST", { values }, true)
                .then((r) => {
                  if (r) location.hash = "instances/" + r.id;
                })
            }
          />
        </Panel>
      )}
    </>
  );
}
function Instances({ rev }: Props) {
  const [filter, set] = useState("");
  const [offset, setOffset] = useState(0);
  const data = useData<Instance[]>(
    instances + "?offset=" + offset + (filter ? "&status=" + filter : ""),
    rev,
  );
  return (
    <>
      <Head
        title="Экземпляры процессов"
        sub="Версии, состояние и сроки исполнения"
      />
      <ErrorBox error={data.error} />
      <Panel title="Список экземпляров">
        <div className="pad toolbar">
          <label>
            Состояние
            <select
              value={filter}
              onChange={(e) => {
                set(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Все</option>
              {["RUNNING", "COMPLETED", "INCIDENT"].map((v) => (
                <option value={v} key={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DataTable
          columns={["Экземпляр", "Процесс", "Версия", "Состояние", "SLA"]}
          rows={(data.data ?? []).map((i) => [
            <a href={"#instances/" + i.id}>{short(i.id)}</a>,
            i.name,
            i.number,
            <Status value={i.status} />,
            stamp(i.due_at),
          ])}
        />
        <div className="pad toolbar">
          <button disabled={!offset} onClick={() => setOffset(offset - 50)}>
            Назад
          </button>
          <button
            disabled={(data.data?.length ?? 0) < 50}
            onClick={() => setOffset(offset + 50)}
          >
            Далее
          </button>
        </div>
      </Panel>
    </>
  );
}
function Monitor({ id, rev }: Props & { id: string }) {
  const [tick, update] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => update((n) => n + 1), 1500);
    return () => clearInterval(timer);
  }, []);
  const result = useData<Instance>(instances + "/" + id, rev + tick);
  const i = result.data;
  if (!i)
    return (
      <>
        <ErrorBox error={result.error} />
        {result.loading && <p>Загрузка экземпляра…</p>}
      </>
    );
  return (
    <>
      <a href="#instances">← Экземпляры</a>
      <Head
        title={i.name}
        sub={short(i.id) + " · опубликованная версия " + i.number}
      >
        <Status value={i.status} />
      </Head>
      <div className="panel pad toolbar">
        <span>Инициатор · {i.initiator}</span>
        <span>Запуск · {stamp(i.created_at)}</span>
        <span>SLA · {stamp(i.due_at)}</span>
        {i.completed_at && (
          <span>
            Время исполнения ·{" "}
            {Math.round(
              (Date.parse(i.completed_at) - Date.parse(i.created_at)) / 1000,
            )}{" "}
            с
          </span>
        )}
      </div>
      <Panel title="Монитор исполнения">
        <Diagram
          xml={i.xml}
          active={[...new Set(i.tokens.map((t) => t.node))].sort()}
          completed={[
            ...new Set(
              i.events
                .filter((e) =>
                  [
                    "FLOW",
                    "TASK_COMPLETED",
                    "TIMER_FIRED",
                    "SERVICE_DONE",
                    "JOINED",
                  ].includes(e.action),
                )
                .map((e) => e.node)
                .filter((node): node is string => Boolean(node)),
            ),
          ].sort()}
          blocked={
            i.status === "INCIDENT"
              ? i.events
                  .filter((e) => e.action === "INCIDENT" && e.node)
                  .slice(-1)
                  .map((e) => e.node!)
              : []
          }
        />
      </Panel>
      <div className="split">
        <Panel title="Активные токены">
          <DataTable
            columns={["Узел", "Состояние"]}
            rows={i.tokens.map((t) => [
              <code>{t.node}</code>,
              <Status value={t.status} />,
            ])}
          />
        </Panel>
        <Panel title="Работа в PostgreSQL">
          <DataTable
            columns={["Тип", "Состояние", "Срок", "Попытки"]}
            rows={i.jobs.map((j) => [
              j.kind,
              j.status,
              stamp(j.due_at),
              j.attempts,
            ])}
          />
        </Panel>
      </div>
      <Panel title="Задачи процесса">
        <DataTable
          columns={["Задача", "Группа", "Срок", "Состояние"]}
          rows={i.tasks.map((t) => [
            t.name,
            t.work_group,
            stamp(t.due_at),
            <Status value={t.status} />,
          ])}
        />
      </Panel>
      <Panel title="Хронология">
        <EventTable events={i.events} />
        <details>
          <summary>Данные экземпляра</summary>
          <Json data={i.vars} />
        </details>
      </Panel>
    </>
  );
}
function Inbox({ rev }: Props) {
  const [filter, set] = useState("");
  const [offset, setOffset] = useState(0);
  const data = useData<Task[]>("/tasks?offset=" + offset + filter, rev);
  return (
    <>
      <Head
        title="Входящие задачи"
        sub="Групповые и назначенные задачи с приоритетом и дедлайном"
      />
      <ErrorBox error={data.error} />
      <Panel title="Задачи">
        <form
          className="pad toolbar"
          onSubmit={(e) => {
            const v = fields(e);
            set(
              "&q=" +
                encodeURIComponent(String(v.get("q"))) +
                (v.get("status") ? "&status=" + v.get("status") : ""),
            );
            setOffset(0);
          }}
        >
          <label>
            Поиск
            <input name="q" />
          </label>
          <label>
            Статус
            <select name="status">
              <option value="">Активные</option>
              {["OPEN", "CLAIMED", "DONE"].map((s) => (
                <option value={s} key={s}>
                  {labels[s]}
                </option>
              ))}
            </select>
          </label>
          <button>Найти</button>
        </form>
        <DataTable
          columns={[
            "Задача",
            "Процесс",
            "Группа",
            "Приоритет",
            "Срок",
            "Состояние",
          ]}
          rows={(data.data ?? []).map((t) => [
            <a href={"#tasks/" + t.id}>{t.name}</a>,
            t.process,
            t.work_group,
            t.priority,
            stamp(t.due_at) + (t.escalated ? " · просрочена" : ""),
            <Status value={t.status} />,
          ])}
        />
        <div className="pad toolbar">
          <button disabled={!offset} onClick={() => setOffset(offset - 50)}>
            Назад
          </button>
          <button
            disabled={(data.data?.length ?? 0) < 50}
            onClick={() => setOffset(offset + 50)}
          >
            Далее
          </button>
        </div>
      </Panel>
    </>
  );
}
function TaskView({ id, rev, refresh }: Props & { id: string }) {
  const data = useData<Task>("/tasks/" + id, rev);
  const t = data.data;
  const act = useAction(refresh);
  if (!t)
    return (
      <>
        <ErrorBox error={data.error} />
        {data.loading && <p>Загрузка задачи…</p>}
      </>
    );
  return (
    <>
      <a href="#tasks">← Задачи</a>
      <Head title={t.name} sub={t.work_group + " · срок " + stamp(t.due_at)}>
        <Status value={t.status} />
      </Head>
      <ErrorBox error={act.error} />
      <Panel title="Выполнение">
        {t.status === "OPEN" ? (
          <div className="pad">
            <button
              className="primary"
              disabled={act.busy}
              onClick={() =>
                void act.call(
                  "/tasks/" + id + "/claim",
                  "POST",
                  { values: {} },
                  true,
                )
              }
            >
              Взять в работу
            </button>
          </div>
        ) : t.status === "CLAIMED" ? (
          <Dynamic
            form={t.form}
            busy={act.busy}
            label="Завершить задачу"
            submit={(values) =>
              void act.call(
                "/tasks/" + id + "/complete",
                "POST",
                { values },
                true,
              )
            }
          />
        ) : (
          <p className="pad">Результат сохранён.</p>
        )}
        <div className="pad">
          <a href={"#instances/" + t.instance}>Открыть данные процесса</a>
        </div>
      </Panel>
    </>
  );
}
function EventTable({ events }: { events: Event[] }) {
  return (
    <DataTable
      columns={["Событие", "Узел", "Время", "Запрос", "Данные"]}
      rows={events.map((e) => [
        e.action,
        e.node ?? "—",
        stamp(e.created_at),
        <code title={e.request}>{short(e.request)}</code>,
        <details>
          <summary>Подробнее</summary>
          <Json data={e.detail} />
        </details>,
      ])}
    />
  );
}
function Audit({ rev }: { rev: number }) {
  const [offset, setOffset] = useState(0);
  const e = useData<Event[]>("/audit?offset=" + offset, rev);
  return (
    <>
      <Head title="Журнал аудита" />
      <ErrorBox error={e.error} />
      <Panel title="События и действия">
        <EventTable events={e.data ?? []} />
        <div className="toolbar pad">
          <button disabled={!offset} onClick={() => setOffset(offset - 100)}>
            Назад
          </button>
          <button
            disabled={(e.data?.length ?? 0) < 100}
            onClick={() => setOffset(offset + 100)}
          >
            Далее
          </button>
        </div>
      </Panel>
    </>
  );
}
function ReportTable({ data }: { data: Row[] }) {
  const keys = Object.keys(data[0] ?? {});
  return (
    <DataTable
      columns={keys}
      rows={data.map((row) => keys.map((k) => String(row[k])))}
    />
  );
}
function Overview({
  rev,
  staff,
  work,
}: {
  rev: number;
  staff: boolean;
  work: boolean;
}) {
  const r = useData<{ instances: Row[] }>(staff ? "/reports" : "", rev);
  const rows = r.data?.instances ?? [];
  const total = (state: string) =>
    rows
      .filter((row) => row.status === state)
      .reduce((count, row) => count + Number(row.count), 0);
  const actions = [
    ["#registry", "Реестр процессов", "Открыть модели и опубликованные версии"],
    [
      "#instances",
      "Экземпляры",
      "Проверить маршрут, задачи и историю выполнения",
    ],
    ...(work
      ? [["#tasks", "Задачи", "Открыть доступную работу своей группы"]]
      : []),
    ...(staff
      ? [
          [
            "#reports",
            "Отчёты SLA",
            "Проверить сроки исполнения процессов и задач",
          ],
          ["#incidents", "Инциденты", "Открыть журнал сервисных ошибок"],
        ]
      : []),
  ];
  return (
    <>
      <Head title="Обзор рабочей области" />
      <ErrorBox error={r.error} />
      {staff && (
        <Panel title="Состояние исполнения">
          {r.data ? (
            <dl className="metrics pad">
              {["RUNNING", "COMPLETED", "INCIDENT"].map((state) => (
                <div key={state}>
                  <dt>{labels[state]}</dt>
                  <dd>{total(state)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="pad muted" role="status">
              Загрузка данных…
            </p>
          )}
        </Panel>
      )}
      <Panel title="Рабочие разделы">
        <DataTable
          columns={["Раздел", "Действие"]}
          rows={actions.map(([href, label, detail]) => [
            <a href={href}>{label}</a>,
            detail,
          ])}
        />
      </Panel>
    </>
  );
}
function Reports({ rev }: { rev: number }) {
  const r = useData<{ instances: Row[]; tasks: Row[] }>("/reports", rev);
  return (
    <>
      <Head
        title="Операционные отчёты"
        sub="Объёмы и нарушения SLA по данным исполнения"
      />
      <ErrorBox error={r.error} />
      <Panel title="Экземпляры по версии">
        <ReportTable data={r.data?.instances ?? []} />
      </Panel>
      <Panel title="Задачи по группе">
        <ReportTable data={r.data?.tasks ?? []} />
      </Panel>
    </>
  );
}
function Incidents({ rev, refresh, user }: Props) {
  const r = useData<
    {
      id: string;
      instance: string;
      code: string;
      opened: string;
      resolved: string | null;
      note: string | null;
    }[]
  >("/incidents", rev);
  const act = useAction(refresh);
  return (
    <>
      <Head
        title="Инциденты исполнения"
        sub="Причина блокировки и контролируемый повтор"
      />
      <ErrorBox error={act.error ?? r.error} />
      <Panel title="Журнал инцидентов">
        <DataTable
          columns={["Сбой", "Экземпляр", "Возник", "Устранён", "Действие"]}
          rows={(r.data ?? []).map((i) => [
            i.code,
            <a href={"#instances/" + i.instance}>{short(i.instance)}</a>,
            stamp(i.opened),
            i.resolved ? stamp(i.resolved) : "Открыт",
            !i.resolved && user.role === "ADMIN" ? (
              <form
                className="toolbar"
                onSubmit={(e) =>
                  void act.call(
                    "/incidents/" + i.id + "/retry",
                    "POST",
                    Object.fromEntries(fields(e)),
                    true,
                  )
                }
              >
                <label>
                  Основание
                  <input name="note" minLength={4} required />
                </label>
                <button disabled={act.busy}>Повторить</button>
              </form>
            ) : (
              i.note
            ),
          ])}
        />
      </Panel>
    </>
  );
}
function UsersPage({ rev, refresh }: Props) {
  const r = useData<
    { login: string; name: string; role: string; groups: string[] }[]
  >("/users", rev);
  const act = useAction(refresh);
  return (
    <>
      <Head title="Участники и группы" />
      <ErrorBox error={r.error ?? act.error} />
      <Panel title="Учётные записи">
        <DataTable
          columns={["Логин", "Имя", "Роль", "Группы"]}
          rows={(r.data ?? []).map((u) => [
            u.login,
            u.name,
            u.role,
            u.groups.join(", "),
          ])}
        />
      </Panel>
      <Panel title="Новый участник">
        <form
          className="pad form"
          onSubmit={(e) => {
            const v = fields(e);
            void act.call("/users", "POST", {
              ...Object.fromEntries(v),
              groups: v.getAll("groups"),
            });
          }}
        >
          <label>
            Логин
            <input name="login" required />
          </label>
          <label>
            Имя
            <input name="name" required />
          </label>
          <label>
            Пароль
            <input name="password" type="password" minLength={12} required />
          </label>
          <label>
            Роль
            <select name="role">
              {[
                "PROCESS_ANALYST",
                "PROCESS_MANAGER",
                "EMPLOYEE",
                "APPROVER",
                "ADMIN",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Группы
            <select name="groups" multiple>
              {["employees", "managers", "finance", "security", "it"].map(
                (x) => (
                  <option key={x}>{x}</option>
                ),
              )}
            </select>
          </label>
          <button className="primary" disabled={act.busy}>
            Создать участника
          </button>
        </form>
      </Panel>
    </>
  );
}
const experiments: Record<string, string> = {
  parallel: "Параллельное согласование",
  branch: "Ветвление по условию",
  success: "Стандартное завершение",
  revision: "Возврат на доработку",
  reject: "Отклонение",
  sla: "Нарушение SLA",
  timer: "Срабатывание таймера",
  replay: "Повтор завершения",
  concurrent: "Конкурентное завершение",
  incident: "Сбой сервиса",
  recover: "Устранение и повтор",
  version: "Новая версия",
  invalid: "Невалидная модель",
  forbidden: "Запрещённая команда",
};
function Lab({ refresh }: Props) {
  const act = useAction(refresh);
  const [result, setResult] = useState<{
    passed: boolean;
    instance: string | null;
    checks: Record<string, boolean>;
    events: Event[];
    traffic: unknown[];
  }>();
  const [choice, setChoice] = useState("parallel");
  return (
    <>
      <Head
        title="Лаборатория Flowent"
        sub="Сценарии исполняются через HTTP в отдельном Compose и PostgreSQL"
      />
      <ErrorBox error={act.error} />
      <Panel title="Эксперименты">
        <form
          className="toolbar pad"
          onSubmit={(e) => {
            e.preventDefault();
            setResult(undefined);
            void act.call<typeof result>("/lab/run/" + choice).then(setResult);
          }}
        >
          <label>
            Сценарий
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              {Object.entries(experiments).map(([id, title]) => (
                <option value={id} key={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={act.busy}>
            {act.busy ? "Выполнение…" : "Запустить сценарий"}
          </button>
        </form>
        <div className="toolbar pad">
          <button
            disabled={act.busy}
            onClick={() => void act.call("/lab/clock", "PUT", { seconds: 15 })}
          >
            Ускорить на 15 секунд
          </button>
          <button
            disabled={act.busy}
            onClick={() => void act.call("/lab/clock", "PUT", { fault: false })}
          >
            Снять учебный сбой
          </button>
        </div>
      </Panel>
      {result && (
        <>
          <Panel
            title={result.passed ? "Проверка пройдена" : "Проверка не пройдена"}
          >
            <div className="pad">
              {result.instance && (
                <a href={"#instances/" + result.instance}>Открыть экземпляр</a>
              )}
            </div>
            <ReportTable
              data={Object.entries(result.checks).map(([name, ok]) => ({
                name,
                ok,
              }))}
            />
            <EventTable events={result.events} />
          </Panel>
          <Panel title="HTTP-запросы и ответы">
            <div className="pad">
              <Json data={result.traffic} />
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Workspace />);
