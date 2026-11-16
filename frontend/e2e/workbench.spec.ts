import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Definition, Instance } from "../src/api";

const password = process.env.FLOWENT_DEMO_PASSWORD ?? "Flowent-demo-local";
const defs = "/api/process-definitions";
const records = "/api/process-instances";
const approve = { result: "approve", comment: "Демонстрационное согласование" };
const input = (amount: number) => ({
  values: {
    amount,
    category: "equipment",
    purpose: "Проверка рабочего пространства",
  },
});
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const link = (page: Page, name: string) =>
  page.getByRole("link", { name, exact: true });

async function actor(request: APIRequestContext, login: string) {
  const response = await request.post("/api/auth/login", {
    data: { login, password },
  });
  expect(response.ok()).toBeTruthy();
  const { token } = await response.json();
  return async <T>(
    path: string,
    method = "GET",
    data?: unknown,
    status = 200,
  ): Promise<T> => {
    const result = await request.fetch(path, {
      method,
      data,
      headers: {
        Authorization: "Bearer " + token,
        "Idempotency-Key": crypto.randomUUID(),
      },
    });
    expect(result.status(), method + " " + path).toBe(status);
    return result.json();
  };
}

async function login(page: Page, name: string, path: string) {
  await page.goto("/#" + path);
  if (await button(page, "Выйти").isVisible())
    await button(page, "Выйти").click();
  await page.getByLabel("Логин", { exact: true }).fill(name);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await button(page, "Войти").click();
  await expect(button(page, "Выйти")).toBeVisible({ timeout: 15000 });
}

async function shot(page: Page, name: string, fullPage = false) {
  if (!process.env.FLOWENT_SHOTS) return;
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await page.mouse.move(1, 1);
  await page.screenshot({
    path: process.env.FLOWENT_SHOTS + "/" + name + ".png",
    fullPage,
  });
}

test("design diagnostics and registry filters keep context", async ({
  page,
}) => {
  test.setTimeout(80000);
  await login(page, "analyst", "registry");
  await expect(link(page, "Корпоративные расходы")).toBeVisible();
  await shot(page, "design-workspace");
  await page.getByLabel("Поиск", { exact: true }).fill("EXPENSE");
  await button(page, "Найти").click();
  await expect(page).toHaveURL(/q=EXPENSE/);
  await link(page, "Корпоративные расходы").click();
  const select = page.getByRole("combobox", { name: "Элемент BPMN" });
  await expect(select.locator("option[value=Solo]")).toHaveCount(1);
  await select.selectOption("Solo");
  await expect(
    page.getByRole("region", { name: "Свойства элемента" }),
  ).toBeVisible();
  await shot(page, "properties", true);
  await page.getByLabel("Element ID").fill("TemporaryAuditId");
  await button(page, "Применить свойства").press("Enter");
  await button(page, "Проверить модель").press("Enter");
  await expect(page.getByRole("alert")).toContainText("Solo");
  await shot(page, "validation-error", true);
  await button(page, "К источнику ошибки").press("Enter");
  await expect(page.getByLabel("Исходник BPMN")).toBeFocused({
    timeout: 15000,
  });
  await link(page, "← Реестр").click();
  await expect(
    page.getByRole("dialog", { name: "Несохранённые изменения" }),
  ).toBeVisible();
  await button(page, "Выйти без сохранения").press("Enter");
  await expect(page).toHaveURL(/#registry\?q=EXPENSE/);
  await expect(page.getByLabel("Поиск", { exact: true })).toHaveValue(
    "EXPENSE",
  );
});

test("runtime derives branch waiting and navigates to the exact model at every width", async ({
  page,
  request,
}) => {
  test.setTimeout(100000);
  const employee = await actor(request, "employee");
  const approver = await actor(request, "approver");
  const finance = await actor(request, "finance");
  const admin = await actor(request, "admin");
  const list = await employee<Definition[]>(defs);
  const expense = list.find((item) => item.code === "EXPENSE")!;
  const started = await employee<Instance>(
    defs + "/" + expense.id + "/start",
    "POST",
    input(150000),
    201,
  );
  const uuid = started.id;
  const instance = () => admin<Instance>(records + "/" + uuid);
  const initial = await instance();
  const lead = initial.tasks.find((task) => task.node === "Lead")!;
  const second = initial.tasks.find((task) => task.node === "Second")!;
  expect(initial.tokens.map((token) => token.status).sort()).toEqual([
    "TASK",
    "TASK",
  ]);
  await login(page, "approver", "tasks/" + lead.id);
  await expect(
    page.getByRole("heading", { name: "Контекст задачи" }),
  ).toBeVisible();
  await expect(page.getByText(lead.id, { exact: true })).toBeVisible();
  await shot(page, "active-task");
  await button(page, "Взять в работу").click();
  await page
    .getByRole("combobox", { name: "Решение", exact: true })
    .selectOption("approve");
  await page.getByLabel("Комментарий", { exact: true }).fill(approve.comment);
  await button(page, "Завершить задачу").click();
  await expect(page.getByText("Результат сохранён.")).toBeVisible();
  await shot(page, "task-completion");

  await login(page, "admin", "instances");
  await expect(
    page.getByRole("heading", { name: "Экземпляры процессов" }),
  ).toBeVisible();
  await expect(page.getByText(uuid.slice(0, 8), { exact: true })).toBeVisible();
  await shot(page, "instance-registry");
  await page
    .getByRole("row")
    .filter({ hasText: uuid.slice(0, 8) })
    .getByRole("link")
    .click();
  await expect(
    page.getByText("достигли шлюза 1 из 2", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Монитор исполнения" }),
  ).toBeVisible();
  await shot(page, "join-wait");
  await page.setViewportSize({ width: 1440, height: 1060 });
  await shot(page, "runtime-viewer");
  const diagram = page.getByRole("region", { name: "BPMN Canvas" });
  await expect(
    diagram.locator('.djs-shape[data-element-id="Join"]'),
  ).toBeVisible();
  const instancePath = page.url();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    await page
      .getByRole("combobox", { name: "Элемент BPMN" })
      .selectOption("Second");
    await expect(
      page.getByRole("heading", { name: second.name }),
    ).toBeVisible();
    if (width === 390) await shot(page, "mobile-viewer", true);
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await link(page, "Открыть версию BPMN").click();
  await expect(
    page.getByRole("heading", { name: "Версия BPMN" }),
  ).toBeVisible();
  await expect(page.getByText(initial.version, { exact: true })).toBeVisible();
  await shot(page, "published-model");
  await page.getByText("Опубликованный BPMN XML", { exact: true }).click();
  expect(await page.locator("pre").last().textContent()).toBe(initial.xml);
  await shot(page, "version-navigation");
  await page.goto(instancePath);
  await expect(
    page.getByRole("heading", { name: "Монитор исполнения" }),
  ).toBeVisible();
  await finance("/api/tasks/" + second.id + "/claim", "POST", { values: {} });
  await finance("/api/tasks/" + second.id + "/complete", "POST", {
    values: approve,
  });
  await expect(
    page.getByRole("cell", { name: "JOINED", exact: true }),
  ).toBeVisible();
  expect(
    (await instance()).events.filter((event) => event.action === "JOINED"),
  ).toHaveLength(1);
});

test("timer, SLA and incident evidence comes from the running engine", async ({
  page,
  request,
}) => {
  test.setTimeout(110000);
  const admin = await actor(request, "admin");
  const employee = await actor(request, "employee");
  const analyst = await actor(request, "analyst");
  const approver = await actor(request, "approver");
  const manager = await actor(request, "manager");
  const expense = (await analyst<Definition[]>(defs)).find(
    (item) => item.code === "EXPENSE",
  )!;
  const source = await analyst<Definition>(defs + "/" + expense.id);
  const xml = source.draft.replace(
    /(<(?:[\w]+:)?timeDuration[^>]*>)PT\d+S/,
    "$1PT120S",
  );
  expect(xml).not.toBe(source.draft);
  const copy = await analyst<Definition>(
    defs,
    "POST",
    { code: "QA-TIMER-" + Date.now(), name: "Расходы · ожидание таймера", xml },
    201,
  );
  const proof = await analyst<{ digest: string }>("/api/validate", "POST", {
    name: copy.name,
    revision: copy.revision,
    xml,
  });
  await manager(
    defs + "/" + copy.id + "/publish",
    "POST",
    { revision: copy.revision, validated_digest: proof.digest },
    201,
  );
  const timer = await employee<Instance>(
    defs + "/" + copy.id + "/start",
    "POST",
    input(12000),
    201,
  );
  const state = () => admin<Instance>(records + "/" + timer.id);
  const task = (await state()).tasks.find((item) => item.node === "Solo")!;
  await approver("/api/tasks/" + task.id + "/claim", "POST", { values: {} });
  await approver("/api/tasks/" + task.id + "/complete", "POST", {
    values: approve,
  });
  await login(page, "admin", "instances/" + timer.id);
  await expect(
    page.getByText("Запланирован BPMN-таймер", { exact: false }),
  ).toBeVisible();
  await shot(page, "timer-wait");

  const late = await admin<{ passed: boolean; instance: string }>(
    "/api/lab/run/sla",
    "POST",
  );
  expect(late.passed).toBe(true);
  await page.evaluate((id) => {
    location.hash = "instances/" + id;
  }, late.instance);
  await expect(
    page.getByText("Нарушен SLA", { exact: true }).first(),
  ).toBeVisible();
  await shot(page, "sla-breach", true);

  const incident = await admin<{ passed: boolean; instance: string }>(
    "/api/lab/run/incident",
    "POST",
  );
  expect(incident.passed).toBe(true);
  const [fault] = await admin<{ id: string; node: string; recovery: string }[]>(
    "/api/incidents?instance=" + incident.instance,
  );
  expect(fault.recovery).toBe("OPEN");
  await page.evaluate((id) => {
    location.hash = "incidents/" + id;
  }, fault.id);
  await expect(
    page.getByRole("heading", { name: "Детали инцидента" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "SERVICE_RETRY", exact: true }),
  ).toHaveCount(2);
  await shot(page, "incident-details", true);
  await page
    .getByLabel("Основание для повтора")
    .fill("Сервис доступен на демонстрационном стенде");
  await button(page, "Поставить повтор в очередь").click();
  await expect(
    page.getByText("Восстановление подтверждено", { exact: true }),
  ).toBeVisible({ timeout: 18000 });
  await expect(
    page.getByRole("cell", { name: "MANUAL_RETRY", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "SERVICE_DONE", exact: true }),
  ).toBeVisible();
  await shot(page, "recovery-history", true);
});
