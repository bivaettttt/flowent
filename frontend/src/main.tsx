import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./styles.css";
import "./workbench.css";
import {
  Fragment,
  useEffect,
  useMemo,
  lazy,
  Suspense,
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
  Menu,
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
import type { CanvasAPI } from "./modeler";
import { time, routeOptions, linkTo, returnTo, modelNodes } from "./process";
const Diagram = lazy(() =>
  import("./modeler").then((module) => ({ default: module.Diagram })),
);

const defs = "/process-definitions",
  instances = "/process-instances";
const stamp = time;
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
  TIMER: "BPMN-таймер",
  WAITING: "Ожидает",
  BLOCKED: "Заблокировано",
  QUEUED: "Повтор поставлен в очередь",
  RETRY_WAITING: "Ожидается следующая попытка",
  RECOVERED: "Восстановление подтверждено",
  FAILED: "Повтор завершился сбоем",
  UNKNOWN: "Результат уточняется",
};
function useData<T>(path: string, rev: number) {
  type Result = { path: string; data?: T; error?: Error; loading: boolean };
  const [state, set] = useState<Result>({ path, loading: Boolean(path) });
  useEffect(() => {
    if (!path) return;
    let active = true;
    set((previous) => ({
      path,
      data: previous.path === path ? previous.data : undefined,
      loading: true,
    }));
    api<T>(path).then(
      (data) => {
        if (active) set({ path, data, loading: false });
      },
      (error) => {
        if (active)
          set((previous) => ({
            path,
            data: previous.data,
            error,
            loading: false,
          }));
      },
    );
    return () => {
      active = false;
    };
  }, [path, rev]);
  return state.path === path
    ? state
    : ({ path, loading: Boolean(path) } as Result);
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
      <div className="title-copy">
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
    <div
      className="scroll"
      role="region"
      tabIndex={0}
      aria-label={"Таблица · " + columns[0]}
    >
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th scope="col" key={i}>
                {c}
              </th>
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
        (["DONE", "COMPLETED", "RECOVERED"].includes(value)
          ? "green"
          : ["INCIDENT", "BLOCKED", "FAILED"].includes(value)
            ? "red"
            : ["JOIN", "TIMER", "WAITING", "QUEUED", "RETRY_WAITING"].includes(
                  value,
                )
              ? "amber"
              : value === "UNKNOWN"
                ? "slate"
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
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLElement>(null);
  const path = route.split("?")[0];
  useEffect(() => {
    content.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [path, user]);
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
  const [page, id, mode, versionId] = path.split("/");
  const props = { rev, refresh, user, route };
  const sections = [
    ["Моделирование", items.filter((item) => item.path === "registry")],
    [
      "Исполнение",
      items.filter((item) =>
        ["overview", "instances", "tasks", "reports", "incidents"].includes(
          item.path,
        ),
      ),
    ],
    [
      "Управление",
      items.filter((item) => ["audit", "users", "lab"].includes(item.path)),
    ],
  ] as const;
  const roleName: Record<string, string> = {
    PROCESS_ANALYST: "Аналитик процессов",
    PROCESS_MANAGER: "Менеджер процессов",
    EMPLOYEE: "Сотрудник",
    APPROVER: "Согласующий",
    ADMIN: "Администратор",
  };
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
        if (next && next !== "main-content" && next !== currentRoute.current) {
          event.preventDefault();
          setDestination(next);
        }
      }}
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          content.current?.focus();
          content.current?.scrollIntoView();
        }}
      >
        К содержимому
      </a>
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
        <div className="side-head">
          <Brand />
          <button
            className="menu-toggle"
            ref={menuButton}
            aria-controls="sections"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={16} aria-hidden="true" /> Разделы
          </button>
        </div>
        <nav
          id="sections"
          aria-label="Разделы"
          className={menu ? "menu-open" : ""}
          onKeyDown={(event) => {
            if (event.key === "Escape" && menu) {
              setMenu(false);
              menuButton.current?.focus();
            }
          }}
        >
          {sections.map(
            ([group, entries]) =>
              entries.length > 0 && (
                <Fragment key={group}>
                  <p className="nav-category">{group}</p>
                  {entries.map(({ path, title, Icon }) => (
                    <a
                      key={path}
                      href={"#" + path}
                      aria-current={page === path ? "page" : undefined}
                      className={page === path ? "active" : ""}
                      onClick={() => setMenu(false)}
                    >
                      <Icon size={16} aria-hidden="true" /> {title}
                    </a>
                  ))}
                </Fragment>
              ),
          )}
        </nav>
        <footer>
          {user.lab ? "Изолированная лаборатория" : "Рабочая область"}
        </footer>
      </aside>
      <div className="workspace">
        <div className="top">
          <span className="identity" title={user.role}>
            {roleName[user.role] ?? user.role}
          </span>
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
        <main id="main-content" tabIndex={-1} ref={content}>
          <ErrorBox error={act.error} />
          <Suspense fallback={<p role="status">Загрузка рабочей области…</p>}>
            {page === "overview" ? (
              <Overview rev={rev} staff={staff} work={work} />
            ) : page === "registry" ? (
              id ? (
                mode === "versions" && versionId ? (
                  <PublishedVersion
                    key={versionId}
                    id={id}
                    version={versionId}
                    {...props}
                  />
                ) : (
                  <Editor key={id} id={id} {...props} leaveGuard={leaveGuard} />
                )
              ) : (
                <Registry {...props} />
              )
            ) : page === "instances" ? (
              id ? (
                mode === "model" ? (
                  <PublishedVersion key={id} instance={id} {...props} />
                ) : (
                  <Monitor key={id} id={id} {...props} />
                )
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
              <Incidents {...props} id={id} />
            ) : page === "audit" && staff ? (
              <Audit rev={rev} />
            ) : page === "users" && user.role === "ADMIN" ? (
              <UsersPage {...props} />
            ) : page === "lab" && user.lab ? (
              <Lab {...props} />
            ) : (
              <Head title="Раздел недоступен" />
            )}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
type Props = { rev: number; refresh: () => void; user: User; route: string };
function Registry({ rev, refresh, user, route }: Props) {
  const options = routeOptions(route);
  const query = new URLSearchParams(options);
  query.set("offset", String(pageOffset(options)));
  const data = useData<Definition[]>(defs + "?" + query, rev);
  const act = useAction(refresh);
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="eyebrow">Моделирование</p>
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
          key={options.toString()}
          onSubmit={(e) => {
            const data = fields(e);
            location.hash = linkTo("registry", {
              q: String(data.get("q")).trim(),
              archived: data.get("archived") === "on" ? "true" : null,
              order: String(data.get("order")),
            });
          }}
        >
          <label>
            Поиск
            <input
              name="q"
              maxLength={100}
              defaultValue={options.get("q") ?? ""}
              placeholder="Название или код"
            />
          </label>
          {!["EMPLOYEE", "APPROVER"].includes(user.role) && (
            <label className="check">
              Архив
              <input
                name="archived"
                type="checkbox"
                defaultChecked={options.get("archived") === "true"}
              />
            </label>
          )}
          <label>
            Порядок
            <select name="order" defaultValue={options.get("order") ?? ""}>
              <option value="">По коду</option>
              <option value="name">По названию</option>
              <option value="updated">По изменению</option>
            </select>
          </label>
          <button>Найти</button>
          {options.size > 0 && <a href="#registry">Сбросить</a>}
        </form>
        {data.loading && !data.data ? (
          <p className="pad">Загрузка…</p>
        ) : (
          <DataTable
            columns={["Процесс", "Редакция", "Публикация", "Статус", "Изменён"]}
            rows={(data.data ?? []).map((d) => [
              <>
                <a href={linkTo("registry/" + d.id, { return: "#" + route })}>
                  {d.name}
                </a>
                <br />
                <code>{d.code}</code>
              </>,
              d.revision,
              d.number ? "v" + d.number : "—",
              d.archived
                ? "Архив"
                : d.active_version
                  ? "Опубликован"
                  : "Черновик",
              stamp(d.updated_at),
            ])}
          />
        )}
        <Pagination route={route} count={data.data?.length ?? 0} />
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
  route,
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
  const [raw, setRaw] = useState<string | null>(null);
  const canvas = useRef<CanvasAPI | null>(null);
  const rawField = useRef<HTMLTextAreaElement>(null);
  const focusRaw = useRef(false);
  useEffect(() => {
    if (raw !== null && focusRaw.current) {
      rawField.current?.focus();
      focusRaw.current = false;
    }
  }, [raw]);
  const edit = ["PROCESS_ANALYST", "ADMIN"].includes(user.role) && !d?.archived;
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
    if (!dirty && override === d?.draft) setOverride(null);
  }, [dirty, override, d?.draft]);
  const validationIssue =
    validationError instanceof ApiError &&
    typeof validationError.detail === "object"
      ? validationError.detail
      : undefined;
  if (!d)
    return (
      <>
        <ErrorBox error={data.error} />
        {data.loading && <p>Загрузка…</p>}
      </>
    );
  return (
    <>
      <div className="path-line">
        <a href={returnTo(route, "registry")}>← Реестр</a>
        <span className="eyebrow">Моделирование</span>
      </div>
      <Head
        title={d.name}
        sub={[
          d.code,
          edit ? "Черновик · редакция " + d.revision : null,
          d.current ? "Опубликована версия " + d.current.number : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <ErrorBox error={act.error ?? data.error} />
      <Panel title="Модель BPMN">
        <div className="pad toolbar editor-actions">
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
              <label className="diagram-import desktop-only">
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
                className="desktop-only"
                onClick={() => void xml().then(setRaw).catch(act.setError)}
              >
                Править XML и конфигурацию
              </button>
              <button
                className="primary desktop-only"
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
          {["PROCESS_MANAGER", "ADMIN"].includes(user.role) && (
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
          {d.current && (
            <a href={linkTo("instances", { definition: d.id })}>
              Экземпляры модели
            </a>
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
        {validationIssue ? (
          <div className="error pad" role="alert">
            <strong>Ошибка проверки модели</strong>
            <p>{validationIssue.message ?? validationIssue.code}</p>
            {validationIssue.element && (
              <p>
                Элемент · <code>{validationIssue.element}</code>{" "}
                <button
                  onClick={() => {
                    if (
                      !canvas.current?.focusElement(
                        validationIssue.element ?? "",
                      )
                    ) {
                      if (rawField.current) rawField.current.focus();
                      else {
                        focusRaw.current = true;
                        void xml().then(setRaw).catch(act.setError);
                      }
                    }
                  }}
                >
                  К источнику ошибки
                </button>
              </p>
            )}
            <p>Публикация заблокирована до успешной проверки.</p>
          </div>
        ) : (
          <ErrorBox error={validationError} />
        )}
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
      </Panel>
      {raw !== null && (
        <Panel title="XML · формы, назначения, условия и таймеры">
          <div className="pad form wide">
            <p>
              Разрешены Start/End, User/Service Task, Exclusive/Parallel Gateway
              и Timer Catch. Настройки находятся в JSON внутри documentation.
            </p>
            <label>
              Исходник BPMN
              <textarea
                id="raw-xml"
                ref={rawField}
                readOnly={!edit}
                rows={16}
                value={raw}
                disabled={act.busy}
                onChange={(e) => {
                  setRaw(e.target.value);
                  changed();
                }}
              />
            </label>
            {edit && (
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
            )}
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
              <a href={linkTo("registry/" + d.id + "/versions/" + v.id)}>
                Открыть XML
              </a>,
            ])}
          />
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
function pageOffset(options: URLSearchParams) {
  const n = Number(options.get("offset"));
  return Number.isSafeInteger(n) && n > 0 && n <= 1_000_000 ? n : 0;
}

function Pagination({ route, count }: { route: string; count: number }) {
  const options = routeOptions(route);
  const offset = pageOffset(options);
  function href(value: number) {
    const next = new URLSearchParams(options);
    if (value > 0) next.set("offset", String(value));
    else next.delete("offset");
    return "#" + route.split("?")[0] + (next.size ? "?" + next : "");
  }
  return (
    <div role="navigation" className="toolbar pad" aria-label="Страницы">
      {offset > 0 ? (
        <a href={href(offset - 50)}>Назад</a>
      ) : (
        <span className="muted">Назад</span>
      )}
      <span>Страница {Math.floor(offset / 50) + 1}</span>
      {count === 50 ? (
        <a href={href(offset + 50)}>Далее</a>
      ) : (
        <span className="muted">Далее</span>
      )}
    </div>
  );
}

function Instances({ rev, route }: Props) {
  const options = routeOptions(route);
  const offset = pageOffset(options);
  const filter = options.get("status") ?? "";
  const term = options.get("q") ?? "";
  const sort = options.get("order") ?? "";
  const definition = options.get("definition");
  const version = options.get("version");
  const request = new URLSearchParams({ offset: String(offset) });
  for (const [key, value] of Object.entries({
    status: filter,
    q: term,
    order: sort,
    definition,
    version,
  }))
    if (value) request.set(key, value);
  const data = useData<Instance[]>(instances + "?" + request, rev);
  return (
    <>
      <p className="eyebrow">Исполнение</p>
      <Head
        title="Экземпляры процессов"
        sub="Состояние, закреплённые версии и открытая работа"
      />
      <Panel title="Список экземпляров">
        <form
          key={options.toString()}
          className="pad toolbar"
          onSubmit={(event) => {
            const values = fields(event);
            location.hash = linkTo("instances", {
              definition,
              version,
              q: String(values.get("q")).trim(),
              status: String(values.get("status")),
              order: String(values.get("order")),
            });
          }}
        >
          <label>
            Поиск
            <input
              name="q"
              maxLength={100}
              defaultValue={term}
              placeholder="Имя, код или Instance ID"
            />
          </label>
          <label>
            Состояние
            <select name="status" defaultValue={filter}>
              <option value="">Все</option>
              {["RUNNING", "COMPLETED", "INCIDENT"].map((value) => (
                <option key={value} value={value}>
                  {labels[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Порядок
            <select name="order" defaultValue={sort}>
              <option value="">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
            </select>
          </label>
          <button>Найти</button>
          {(definition || version || filter || sort || term) && (
            <a href="#instances">Сбросить</a>
          )}
        </form>
        {definition && (
          <p className="pad muted">
            Фильтр модели {short(definition)}
            {version && " · версия " + short(version)}
          </p>
        )}
        {data.error ? (
          <ErrorBox error={data.error} />
        ) : data.loading && !data.data ? (
          <p className="pad" role="status">
            Загрузка экземпляров…
          </p>
        ) : (
          <DataTable
            columns={[
              "Экземпляр и процесс",
              "Версия",
              "Состояние",
              "Запущен",
              "Задачи",
              "Инциденты",
            ]}
            rows={(data.data ?? []).map((item) => [
              <>
                <a
                  href={linkTo("instances/" + item.id, { return: "#" + route })}
                >
                  {item.name}
                </a>
                <br />
                <code title={item.id}>{short(item.id)}</code>
              </>,
              "v" + item.number,
              <Status value={item.status} />,
              stamp(item.created_at),
              item.active_tasks ?? "—",
              item.open_incidents ?? "—",
            ])}
          />
        )}
        {!data.error && (
          <Pagination route={route} count={data.data?.length ?? 0} />
        )}
      </Panel>
    </>
  );
}

function PublishedVersion({
  id,
  version,
  instance,
  rev,
  route,
}: Props & { id?: string; version?: string; instance?: string }) {
  const data = useData<{
    id: string;
    xml: string;
    number: number;
    created_at?: string;
    name?: string;
    version?: string;
    definition?: string;
  }>(
    instance
      ? instances + "/" + instance
      : defs + "/" + id + "/versions/" + version,
    rev,
  );
  const published = data.data;
  if (!published)
    return (
      <>
        <Head title="Опубликованная модель" />
        {data.loading ? (
          <p role="status">Загрузка точной версии…</p>
        ) : (
          <ErrorBox error={data.error} />
        )}
      </>
    );
  const pinned = instance ? published.version : published.id;
  const back = routeOptions(route).get("return");
  const instanceRoute = "#instances/" + instance;
  const backToInstance = back?.startsWith(instanceRoute + "?")
    ? back
    : instanceRoute;
  return (
    <>
      <div className="path-line">
        <a href={instance ? backToInstance : "#registry/" + id}>
          {instance ? "← К экземпляру" : "← К модели"}
        </a>
        <span className="eyebrow">Опубликованная версия</span>
      </div>
      <Head
        title={published.name ?? "Опубликованная модель"}
        sub={"Версия " + published.number + " · неизменяемый снимок BPMN"}
      >
        {(published.definition || id) && (
          <a
            href={linkTo("instances", {
              definition: published.definition ?? id,
              version: pinned,
            })}
          >
            Экземпляры версии
          </a>
        )}
      </Head>
      <dl className="panel workspace-meta">
        <div>
          <dt>Version ID</dt>
          <dd>
            <code className="wrap-id">{pinned}</code>
          </dd>
        </div>
        {published.created_at && !instance && (
          <div>
            <dt>Публикация</dt>
            <dd>{stamp(published.created_at)}</dd>
          </div>
        )}
        {instance && (
          <div>
            <dt>Instance ID</dt>
            <dd>
              <code className="wrap-id">{instance}</code>
            </dd>
          </div>
        )}
      </dl>
      <Panel title="Версия BPMN">
        <Diagram
          xml={published.xml}
          selectedId={routeOptions(route).get("node") ?? undefined}
        />
      </Panel>
      <details className="panel">
        <summary>Опубликованный BPMN XML</summary>
        <pre>{published.xml}</pre>
      </details>
    </>
  );
}

function deadline(
  due: string,
  observed: string | undefined,
  completed?: string | null,
) {
  if (!(completed || observed)) return "Срок указан";
  const ms = Date.parse(due) - Date.parse((completed || observed)!);
  if (completed) return ms < 0 ? "Завершено после срока" : "Завершено в срок";
  const minutes = Math.floor(Math.abs(ms) / 60000);
  return (
    (ms < 0 ? "Просрочено · " : "Осталось · ") +
    (minutes < 1
      ? "менее минуты"
      : minutes >= 60
        ? Math.floor(minutes / 60) + " ч " + (minutes % 60) + " мин"
        : minutes + " мин")
  );
}

function WaitingReason({
  item,
  select,
}: {
  item: Instance;
  select: (id: string) => void;
}) {
  const unique = new Set<string>();
  const joins = item.tokens.flatMap((token) => {
    const frame = token.stack?.at(-1);
    if (token.status !== "JOIN" || !frame || unique.has(frame.fork)) return [];
    unique.add(frame.fork);
    const forked = item.events.find(
      (event) =>
        event.action === "FORKED" &&
        (event.detail as { fork?: string } | null)?.fork === frame.fork,
    );
    const branches = (forked?.detail as { branches?: string[] } | undefined)
      ?.branches;
    const peers = item.tokens.filter((candidate) =>
      candidate.stack?.some((entry) => entry.fork === frame.fork),
    );
    const arrived = new Set(
      peers
        .filter(
          (candidate) =>
            candidate.status === "JOIN" &&
            candidate.node === frame.join &&
            candidate.stack.at(-1)?.fork === frame.fork,
        )
        .map((candidate) => candidate.stack.at(-1)?.branch),
    );
    const waiting = branches?.filter((branch) => !arrived.has(branch));
    return [{ frame, waiting, arrived, peers }];
  });
  const pendingTimer = item.jobs.find(
    (job) => job.kind === "TIMER" && job.status === "WAITING",
  );
  const blocked =
    item.status === "INCIDENT"
      ? [...item.events].reverse().find((event) => event.action === "INCIDENT")
      : undefined;
  const tasks = item.tasks.filter((task) => task.status !== "DONE");
  return (
    <section className="panel pad runtime-callout">
      <h2>
        {item.status === "COMPLETED"
          ? "Исполнение завершено"
          : item.status === "INCIDENT"
            ? "Что блокирует исполнение?"
            : "Почему процесс ожидает?"}
      </h2>
      {blocked?.node && (
        <p>
          Сервисный шаг заблокирован.{" "}
          <button onClick={() => select(blocked.node!)}>
            К элементу {blocked.node}
          </button>
        </p>
      )}
      {joins.map(({ frame, waiting, arrived, peers }) => (
        <div key={frame.fork}>
          <p>
            <strong>
              {frame.split} → {frame.join}
            </strong>
            {waiting
              ? " · достигли шлюза " +
                arrived.size +
                " из " +
                (arrived.size + waiting.length)
              : " · ожидаются ветви"}
          </p>
          {waiting && (
            <p>
              Шлюз ожидает следующие входы ({waiting.length}) ·{" "}
              <code>{waiting.join(", ")}</code>.
            </p>
          )}
          <ul>
            {peers
              .filter((token) => token.status !== "JOIN")
              .map((token) => (
                <li key={token.id}>
                  <button onClick={() => select(token.node)}>
                    {tasks.find((task) => task.node === token.node)?.name ??
                      token.node}
                  </button>{" "}
                  <Status value={token.status} />
                </li>
              ))}
          </ul>
        </div>
      ))}
      {pendingTimer && (
        <p>
          Запланирован BPMN-таймер{" "}
          <button onClick={() => select(pendingTimer.node)}>
            {pendingTimer.node}
          </button>{" "}
          · {stamp(pendingTimer.due_at)}
        </p>
      )}
      {tasks.length > 0 && joins.length === 0 && !blocked && (
        <p>
          Активные задачи · {tasks.length}. Движок продолжит маршрут после
          завершения соответствующих шагов.
        </p>
      )}
      {!blocked &&
        !pendingTimer &&
        !joins.length &&
        !tasks.length &&
        item.status === "RUNNING" && (
          <p>Состояние уточняется по доступным токенам и событиям.</p>
        )}
      {item.status === "COMPLETED" && (
        <p>
          Завершено {stamp(item.completed_at)}. Бизнес-исход указан конечным
          элементом в истории.
        </p>
      )}
    </section>
  );
}

function Monitor({ id, rev, route, user }: Props & { id: string }) {
  const [tick, update] = useState(0);
  const [selection, setSelection] = useState(
    routeOptions(route).get("node") ?? "",
  );
  const result = useData<Instance>(instances + "/" + id, rev + tick);
  const i = result.data;
  const status = i?.status;
  useEffect(() => {
    if (!status || status === "COMPLETED") return;
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") update((n) => n + 1);
      },
      status === "INCIDENT" ? 4000 : 1500,
    );
    return () => clearInterval(timer);
  }, [status]);
  useEffect(() => {
    setSelection(routeOptions(route).get("node") ?? "");
  }, [route]);
  const nodes = useMemo(() => (i?.xml ? modelNodes(i.xml) : []), [i?.xml]);
  if (!i)
    return (
      <>
        <ErrorBox error={result.error} />
        {result.loading && <p role="status">Загрузка экземпляра…</p>}
      </>
    );
  const node = nodes.find((candidate) => candidate.id === selection);
  const tasks = i.tasks.filter((task) => !selection || task.node === selection);
  const staff = ["PROCESS_MANAGER", "ADMIN"].includes(user.role);
  const pinned = linkTo("instances/" + i.id + "/model", {
    node: selection,
    return: "#" + route,
  });
  const relatedEvents = selection
    ? i.events.filter((event) => event.node === selection)
    : i.events;
  return (
    <>
      <div className="path-line">
        <a href={returnTo(route, "instances")}>← Экземпляры</a>
        <span className="eyebrow">Исполнение</span>
      </div>
      <Head
        title={i.name}
        sub={
          "Экземпляр " + short(i.id) + " · опубликованная версия " + i.number
        }
      >
        <div className="toolbar">
          <Status value={i.status} />
          <a href={pinned}>Открыть версию BPMN</a>
        </div>
      </Head>
      <ErrorBox error={result.error} />
      <div className="runtime-summary">
        <WaitingReason item={i} select={setSelection} />
        <section className="panel pad runtime-details">
          <h2>Исполнение и сроки</h2>
          <dl className="facts">
            <div>
              <dt>Инициатор</dt>
              <dd>{i.initiator}</dd>
            </div>
            <div>
              <dt>Запуск</dt>
              <dd>{stamp(i.created_at)}</dd>
            </div>
            <div>
              <dt>SLA экземпляра</dt>
              <dd>
                {stamp(i.due_at)}
                <br />
                {deadline(i.due_at, i.observed_at, i.completed_at)}
              </dd>
            </div>
            <div>
              <dt>Instance ID</dt>
              <dd>
                <code className="wrap-id">{i.id}</code>
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <Panel title="Монитор исполнения">
        <p className="pad muted">
          Активные шаги отмечены синим, пройденные — зелёным, заблокированные —
          красным. Текстовые состояния приведены ниже.
        </p>
        <Diagram
          xml={i.xml}
          selectedId={selection}
          onSelect={setSelection}
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
                .filter((id): id is string => Boolean(id)),
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
        {selection && (
          <div className="pad node-properties">
            <h3>{node?.name ?? selection}</h3>
            <p>
              {node?.type ?? "Шаг исполнения"} · <code>{selection}</code>
            </p>
            <p>
              {i.tokens
                .filter((t) => t.node === selection)
                .map((t) => labels[t.status] ?? t.status)
                .join(" · ") || "Активных токенов на шаге нет"}
            </p>
            <a href={pinned}>Этот элемент в опубликованной версии</a>{" "}
            <button onClick={() => setSelection("")}>Показать все шаги</button>
          </div>
        )}
      </Panel>
      <div className="split">
        <Panel title="Активные токены">
          <DataTable
            columns={["Узел", "Состояние"]}
            rows={i.tokens.map((token) => [
              <button onClick={() => setSelection(token.node)}>
                {token.node}
              </button>,
              <Status value={token.status} />,
            ])}
          />
        </Panel>
        <Panel title="Запланированные работы">
          <DataTable
            columns={[
              "Тип",
              "Узел",
              "Состояние",
              "Запланировано",
              "Сработало",
              "Попытки",
            ]}
            rows={i.jobs.map((job) => [
              job.kind === "TIMER" ? "BPMN-таймер" : "Сервис",
              <button onClick={() => setSelection(job.node)}>
                {job.node}
              </button>,
              <Status value={job.status} />,
              stamp(job.due_at),
              stamp(job.finished_at),
              job.attempts,
            ])}
          />
        </Panel>
      </div>
      <Panel title={selection ? "Задачи выбранного шага" : "Задачи процесса"}>
        <DataTable
          columns={["Задача", "Группа", "Срок задачи", "Состояние"]}
          rows={tasks.map((task) => [
            <>
              {staff ||
              !user.groups.includes(task.work_group) ||
              (task.work_group === "employees" && i.owner !== user.id) ||
              (task.assignee && task.assignee !== user.id) ? (
                task.name
              ) : (
                <a href={linkTo("tasks/" + task.id, { return: "#" + route })}>
                  {task.name}
                </a>
              )}
              {task.escalated && (
                <>
                  <br />
                  <span className="status amber">Нарушен SLA</span>
                </>
              )}
            </>,
            task.work_group,
            stamp(task.due_at),
            <Status value={task.status} />,
          ])}
        />
      </Panel>
      {staff && i.events.some((event) => event.action === "INCIDENT") && (
        <p className="path-line">
          <a href={linkTo("incidents", { instance: i.id })}>
            Инциденты этого экземпляра
          </a>
        </p>
      )}
      <Panel title={selection ? "Хронология выбранного шага" : "Хронология"}>
        <EventTable events={relatedEvents} select={setSelection} />
        <details>
          <summary>Данные экземпляра</summary>
          <Json data={i.vars} />
        </details>
      </Panel>
    </>
  );
}
function Inbox({ rev, route }: Props) {
  const options = routeOptions(route);
  const query = new URLSearchParams(options);
  query.set("offset", String(pageOffset(options)));
  const data = useData<Task[]>("/tasks?" + query, rev);
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
          key={options.toString()}
          onSubmit={(e) => {
            const values = fields(e);
            location.hash = linkTo("tasks", {
              q: String(values.get("q")).trim(),
              status: String(values.get("status")),
            });
          }}
        >
          <label>
            Поиск
            <input
              name="q"
              maxLength={100}
              defaultValue={options.get("q") ?? ""}
            />
          </label>
          <label>
            Статус
            <select name="status" defaultValue={options.get("status") ?? ""}>
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
            "Назначение",
            "Приоритет",
            "Срок",
            "Состояние",
          ]}
          rows={(data.data ?? []).map((t) => [
            <a href={linkTo("tasks/" + t.id, { return: "#" + route })}>
              {t.name}
            </a>,
            t.process,
            t.work_group,
            t.assignee_name ?? "Не назначена",
            t.priority,
            stamp(t.due_at) + (t.escalated ? " · просрочена" : ""),
            <Status value={t.status} />,
          ])}
        />
        <Pagination route={route} count={data.data?.length ?? 0} />
      </Panel>
    </>
  );
}
function TaskView({ id, rev, refresh, route }: Props & { id: string }) {
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
      <div className="path-line">
        <a href={returnTo(route, "tasks")}>← Задачи</a>
        <span className="eyebrow">Исполнение</span>
      </div>
      <Head
        title={t.name}
        sub={
          (t.process ?? "Процесс") +
          (t.number ? " · опубликованная версия " + t.number : "")
        }
      >
        <Status value={t.status} />
      </Head>
      <Panel title="Контекст задачи">
        <div className="pad">
          <dl className="facts">
            <div>
              <dt>Приоритет</dt>
              <dd>{t.priority}</dd>
            </div>
            <div>
              <dt>Назначена</dt>
              <dd>
                {t.assignee_name ?? "Не назначена"} · {t.work_group}
              </dd>
            </div>
            <div>
              <dt>BPMN-шаг</dt>
              <dd>
                <a href={linkTo("instances/" + t.instance, { node: t.node })}>
                  {t.node}
                </a>
              </dd>
            </div>
            <div>
              <dt>Начало SLA задачи</dt>
              <dd>{stamp(t.started_at)}</dd>
            </div>
            <div>
              <dt>Срок задачи</dt>
              <dd>
                {stamp(t.due_at)} ·{" "}
                {deadline(t.due_at, t.observed_at, t.completed_at)}
                {t.escalated && <strong> · Нарушен SLA</strong>}
              </dd>
            </div>
            <div>
              <dt>Task ID</dt>
              <dd>
                <code className="wrap-id">{id}</code>
              </dd>
            </div>
            <div>
              <dt>Instance ID</dt>
              <dd>
                <code className="wrap-id">{t.instance}</code>
              </dd>
            </div>
          </dl>
          {t.input != null && (
            <details>
              <summary>Входные данные процесса</summary>
              <Json data={t.input} />
            </details>
          )}
        </div>
      </Panel>
      <ErrorBox error={data.error ?? act.error} />
      {act.error instanceof ApiError && act.error.status === 409 && (
        <button onClick={refresh}>Обновить состояние задачи</button>
      )}
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
          <div className="pad">
            <p role="status">Результат сохранён.</p>
            <p>Подтверждено {stamp(t.completed_at)}</p>
            {t.submission != null && (
              <details>
                <summary>Результат отправки</summary>
                <Json data={t.submission} />
              </details>
            )}
          </div>
        )}
        <div className="pad">
          <a href={linkTo("instances/" + t.instance, { node: t.node })}>
            Открыть данные процесса
          </a>
        </div>
      </Panel>
    </>
  );
}
function EventTable({
  events,
  select,
}: {
  events: Event[];
  select?: (id: string) => void;
}) {
  return (
    <DataTable
      columns={["Событие", "Узел", "Время", "Запрос", "Данные"]}
      rows={events.map((e) => [
        e.action,
        e.node && select ? (
          <button onClick={() => select(e.node!)}>{e.node}</button>
        ) : e.instance ? (
          <a href={linkTo("instances/" + e.instance, { node: e.node })}>
            {e.node ?? "Экземпляр"}
          </a>
        ) : (
          (e.node ?? "—")
        ),
        stamp(e.created_at),
        <code title={e.request}>{short(e.request)}</code>,
        <details>
          <summary>Подробнее</summary>
          <dl className="facts">
            <div>
              <dt>Request ID</dt>
              <dd>
                <code className="wrap-id">{e.request}</code>
              </dd>
            </div>
            {e.actor && (
              <div>
                <dt>Actor ID</dt>
                <dd>
                  <code className="wrap-id">{e.actor}</code>
                </dd>
              </div>
            )}
          </dl>
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
  const labels: Record<string, string> = {
    status: "Состояние",
    count: "Количество",
    breached: "Просрочено",
    work_group: "Группа",
    group: "Группа",
    version: "Версия",
    name: "Процесс",
    process_name: "Процесс",
  };
  return (
    <DataTable
      columns={keys.map((key) => labels[key] ?? key)}
      rows={data.map((row) =>
        keys.map((key) =>
          key === "status" ? (
            <Status value={String(row[key])} />
          ) : (
            String(row[key] ?? "—")
          ),
        ),
      )}
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
        sub="Сроки экземпляров и задач по данным исполнения · время в UTC"
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
type Incident = {
  id: string;
  instance: string;
  node: string;
  number: number;
  process: string;
  version: string;
  code: string;
  opened: string;
  resolved: string | null;
  recovered_at: string | null;
  recovery: string;
  attempts: number;
  due_at: string;
  note: string | null;
  next_incident: string | null;
  job: string;
  previous_resolved: string | null;
  next_opened: string | null;
};

function Incidents({ rev, refresh, user, route, id }: Props & { id?: string }) {
  const instance = routeOptions(route).get("instance");
  const query = new URLSearchParams();
  if (id) query.set("id", id);
  if (instance) query.set("instance", instance);
  const [tick, setTick] = useState(0);
  const result = useData<Incident[]>("/incidents?" + query, rev + tick);
  const current = id ? result.data?.[0] : undefined;
  const execution = useData<Instance>(
    current ? instances + "/" + current.instance : "",
    rev + tick,
  );
  const act = useAction(refresh);
  const needsPolling = Boolean(
    result.data?.some((item) =>
      ["QUEUED", "RETRY_WAITING"].includes(item.recovery),
    ),
  );
  useEffect(() => {
    if (!needsPolling) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setTick((tick) => tick + 1);
    }, 2000);
    return () => clearInterval(timer);
  }, [needsPolling]);
  function explanation(item: Incident) {
    if (item.recovery === "OPEN")
      return "Сервисное задание заблокировано. Устраните причину и запланируйте повтор.";
    if (item.recovery === "RECOVERED")
      return "Сервисное задание завершилось. Проверьте следующий шаг экземпляра.";
    if (item.recovery === "FAILED")
      return "Повтор вновь заблокировал задание. Откройте связанный инцидент.";
    if (item.recovery === "UNKNOWN")
      return "Доступная история задания не подтверждает результат. Проверьте экземпляр и связанные события.";
    return "Команда принята. Результат станет известен после обработки задания.";
  }
  return (
    <>
      <div className="path-line">
        {id && <a href={linkTo("incidents", { instance })}>← Инциденты</a>}
        <span className="eyebrow">Исполнение</span>
      </div>
      <Head
        title={current ? "Инцидент · " + current.code : "Инциденты исполнения"}
        sub={
          current
            ? current.process + " · опубликованная версия " + current.number
            : "Диагностика блокировок и подтверждение результата повтора"
        }
      >
        {current && (
          <Status
            value={current.recovery === "OPEN" ? "INCIDENT" : current.recovery}
          />
        )}
      </Head>
      <ErrorBox error={act.error ?? result.error} />
      {current ? (
        <>
          <section className="panel pad runtime-callout">
            <h2>Состояние восстановления</h2>
            <p>{explanation(current)}</p>
            {current.next_incident && (
              <a href={"#incidents/" + current.next_incident}>
                Открыть следующий инцидент
              </a>
            )}
          </section>
          <Panel title="Детали инцидента">
            <div className="pad">
              <dl className="facts">
                <div>
                  <dt>Причина</dt>
                  <dd>
                    {current.code === "GUARD_UNAVAILABLE"
                      ? "Сервисная проверка недоступна"
                      : current.code}
                  </dd>
                </div>
                <div>
                  <dt>BPMN-элемент</dt>
                  <dd>
                    <a
                      href={linkTo("instances/" + current.instance, {
                        node: current.node,
                      })}
                    >
                      {current.node} · Монитор
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>Возник</dt>
                  <dd>{stamp(current.opened)}</dd>
                </div>
                <div>
                  <dt>Повтор запрошен</dt>
                  <dd>{stamp(current.resolved)}</dd>
                </div>
                <div>
                  <dt>Плановая попытка</dt>
                  <dd>
                    {["QUEUED", "RETRY_WAITING"].includes(current.recovery)
                      ? stamp(current.due_at)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Подтверждение</dt>
                  <dd>{stamp(current.recovered_at)}</dd>
                </div>
                <div>
                  <dt>Incident ID</dt>
                  <dd>
                    <code className="wrap-id">{current.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Instance ID</dt>
                  <dd>
                    <code className="wrap-id">{current.instance}</code>
                  </dd>
                </div>
              </dl>
              {current.note && (
                <p className="notice">Основание · {current.note}</p>
              )}
              {user.role === "ADMIN" && current.recovery === "OPEN" && (
                <form
                  className="toolbar"
                  onSubmit={(e) => {
                    void act.call(
                      "/incidents/" + current.id + "/retry",
                      "POST",
                      Object.fromEntries(fields(e)),
                      true,
                    );
                  }}
                >
                  <label>
                    Основание для повтора
                    <input name="note" required minLength={4} maxLength={240} />
                  </label>
                  <button className="primary" disabled={act.busy}>
                    Поставить повтор в очередь
                  </button>
                </form>
              )}
              {current.recovery !== "OPEN" && (
                <a
                  href={linkTo("instances/" + current.instance + "/model", {
                    node: current.node,
                  })}
                >
                  Версия BPMN и проблемный шаг
                </a>
              )}
            </div>
          </Panel>
          <Panel title="История восстановления">
            <EventTable
              events={(execution.data?.events ?? []).filter((event) => {
                const detail = event.detail as {
                  incident?: string;
                  job?: string;
                } | null;
                if (event.action === "MANUAL_RETRY")
                  return detail?.incident === current.id;
                if (
                  !["INCIDENT", "SERVICE_RETRY", "SERVICE_DONE"].includes(
                    event.action,
                  ) ||
                  event.node !== current.node
                )
                  return false;
                if (
                  current.next_opened &&
                  Date.parse(event.created_at) >=
                    Date.parse(current.next_opened)
                )
                  return false;
                if (!detail?.job)
                  return (
                    Date.parse(event.created_at) >= Date.parse(current.opened)
                  );
                return (
                  detail.job === current.job &&
                  (!current.previous_resolved ||
                    Date.parse(event.created_at) >=
                      Date.parse(current.previous_resolved))
                );
              })}
            />
          </Panel>
        </>
      ) : result.loading && !result.data ? (
        <p role="status">Загрузка инцидентов…</p>
      ) : (
        <Panel title="Журнал инцидентов">
          {instance && (
            <p className="pad">
              <a href={"#instances/" + instance}>К экземпляру</a> ·{" "}
              <a href="#incidents">Все инциденты</a>
            </p>
          )}
          <DataTable
            columns={["Сбой", "Экземпляр", "Возник", "Восстановление"]}
            rows={(result.data ?? []).map((item) => [
              <>
                <a href={linkTo("incidents/" + item.id, { instance })}>
                  {item.code}
                </a>
                <br />
                <span className="muted">
                  {item.node} · v{item.number}
                </span>
              </>,
              <a
                href={linkTo("instances/" + item.instance, { node: item.node })}
              >
                {item.process} · {short(item.instance)}
              </a>,
              stamp(item.opened),
              item.recovery === "OPEN" ? (
                <Status value="INCIDENT" />
              ) : (
                <Status value={item.recovery} />
              ),
            ])}
          />
        </Panel>
      )}
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
            <DataTable
              columns={["Проверка движка", "Код", "Результат"]}
              rows={Object.entries(result.checks).map(([name, ok]) => [
                (
                  {
                    two_branches: "Созданы две отдельные ветви",
                    join_waits: "Шлюз ожидал вторую ветвь",
                    single_join: "Шлюз продолжил исполнение один раз",
                    timer_fired: "Отложенный шаг сработал",
                    completed: "Процесс завершился",
                    escalated: "Нарушение SLA зарегистрировано",
                    blocked: "Ошибка заблокировала исполнение",
                    resumed: "Сервисный шаг завершился после повтора",
                    pinned_version: "Экземпляры сохранили закреплённые версии",
                    replayed: "Прежняя квитанция возвращена",
                    single_completion: "Задача выполнена один раз",
                    model_rejected: "Компилятор обнаружил ошибку",
                    scope_denied: "Команда вне области отклонена",
                    two_commits: "Обе команды завершились",
                    new_task: "Создана новая задача согласования",
                    rejected_route: "Достигнут исход отклонения",
                  } as Record<string, string>
                )[name] ?? name,
                <code>{name}</code>,
                ok ? "Подтверждено" : "Расхождение",
              ])}
            />
            <EventTable events={result.events} />
          </Panel>
          <Panel title="HTTP-запросы и ответы">
            <div className="pad">
              <details>
                <summary>Открыть HTTP-трассу</summary>
                <Json data={result.traffic} />
              </details>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Workspace />);
