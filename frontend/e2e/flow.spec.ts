import { expect, test, type Page } from "@playwright/test";

const password = process.env.FLOWENT_DEMO_PASSWORD ?? "Flowent-demo-local";
async function login(page: Page, user: string) {
  await page.getByLabel("Логин", { exact: true }).fill(user);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Выйти" })).toBeVisible();
}
async function swap(page: Page, user: string) {
  await page.getByRole("button", { name: "Выйти" }).click();
  await login(page, user);
}
async function nav(page: Page, label: string) {
  await page.getByRole("link", { name: label, exact: true }).click();
}
async function button(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function shot(page: Page, name: string) {
  if (!process.env.FLOWENT_SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: process.env.FLOWENT_SHOTS + "/" + name + ".png",
  });
}

test("visual BPMN edit survives save, validation, deployment and execution", async ({
  page,
}) => {
  await page.goto("/");
  await login(page, "analyst");
  await expect(
    page.getByRole("link", { name: "Корпоративные расходы", exact: true }),
  ).toBeVisible();
  await shot(page, "registry");
  const draft = await page.request.get("/api/openapi.json");
  expect(draft.ok()).toBeTruthy();
  await nav(page, "Корпоративные расходы");
  await expect(page.locator('[data-element-id="Solo"]').first()).toBeVisible();
  const exported = page.waitForEvent("download");
  await button(page, "Экспорт XML");
  const file = await exported;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const xml = Buffer.concat(chunks).toString("utf8");
  await nav(page, "Процессы");
  await button(page, "Новый процесс");
  const code = "E2E-" + Date.now();
  await page.getByLabel("Код", { exact: true }).fill(code);
  await page.getByRole("textbox", { name: "Название", exact: true }).fill(code);
  await page.getByRole("textbox", { name: "BPMN XML", exact: true }).fill(xml);
  await button(page, "Создать черновик");
  await expect(
    page.getByRole("heading", { name: code, exact: true }),
  ).toBeVisible();
  await page.locator('.djs-shape[data-element-id="Solo"]').click();
  await page.getByLabel("Название элемента").fill("Решение по заявке E2E");
  await button(page, "Применить свойства");
  await expect(
    page.locator('.djs-shape[data-element-id="Solo"]'),
  ).toContainText("Решение по заявке E2E");
  await shot(page, "designer");
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      r.url().includes("/process-definitions/"),
  );
  await button(page, "Сохранить черновик");
  expect((await saved).ok()).toBeTruthy();
  await button(page, "Проверить модель");
  await expect(page.getByRole("status")).toContainText(
    "Модель прошла проверку",
  );
  await shot(page, "validation");
  await swap(page, "manager");
  const published = page.waitForResponse((r) => r.url().endsWith("/publish"));
  await button(page, "Опубликовать сохранённое");
  expect((await published).status()).toBe(201);
  await expect(page.getByRole("button", { name: "Открыть XML" })).toBeVisible();
  await shot(page, "versions");
  await swap(page, "employee");
  await page.getByLabel("Сумма, ₽").fill("12000");
  await page
    .getByRole("combobox", { name: "Категория", exact: true })
    .selectOption("equipment");
  await page.getByLabel("Назначение").fill("Учебная покупка");
  await button(page, "Запустить процесс");
  await expect(
    page.getByRole("heading", { name: "Монитор исполнения" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Решение по заявке E2E", exact: true }),
  ).toBeVisible();
  const instance = page.url().split("#")[1];
  await shot(page, "monitor");
  await swap(page, "approver");
  await nav(page, "Задачи");
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: code })
      .getByRole("link", { name: "Решение по заявке E2E", exact: true }),
  ).toBeVisible();
  await shot(page, "inbox");
  await page
    .getByRole("row")
    .filter({ hasText: code })
    .getByRole("link", { name: "Решение по заявке E2E", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Взять в работу" }),
  ).toBeVisible();
  await shot(page, "task-details");
  await button(page, "Взять в работу");
  await page
    .getByRole("combobox", { name: "Решение", exact: true })
    .selectOption("approve");
  await page
    .getByLabel("Комментарий", { exact: true })
    .fill("Учебное согласование");
  await shot(page, "task");
  await button(page, "Завершить задачу");
  await expect(page.getByText("Результат сохранён.")).toBeVisible();
  await swap(page, "admin");
  await nav(page, "Лаборатория");
  await button(page, "Ускорить на 15 секунд");
  await swap(page, "employee");
  await page.evaluate((v) => (location.hash = v), instance);
  await expect(
    page.getByRole("cell", { name: "TIMER_FIRED", exact: true }),
  ).toBeVisible();
  await nav(page, "Задачи");
  const fulfil = page
    .getByRole("row")
    .filter({ hasText: code })
    .getByRole("link", { name: "Подтвердить расход" });
  await fulfil.click();
  await button(page, "Взять в работу");
  await page
    .getByLabel("Подтверждение", { exact: true })
    .fill("Расход подтверждён");
  await button(page, "Завершить задачу");
  await expect(page.getByText("Результат сохранён.")).toBeVisible();
  await nav(page, "Открыть данные процесса");
  await expect(page.getByText("Завершён", { exact: true })).toBeVisible();
});

test("lab checks both branches and preserves their transition evidence", async ({
  page,
}) => {
  await page.goto("/");
  await login(page, "admin");
  await nav(page, "Лаборатория");
  await button(page, "Запустить сценарий");
  await expect(
    page.getByRole("heading", { name: "Проверка пройдена" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "join_waits", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "JOINED", exact: true }),
  ).toBeVisible();
  await shot(page, "lab");
  await nav(page, "Отчёты SLA");
  await expect(
    page.getByRole("cell", { name: "EXPENSE", exact: true }).first(),
  ).toBeVisible();
  await shot(page, "reports");
  await nav(page, "Обзор");
  await expect(page.locator(".metrics dd").first()).toBeVisible();
  await shot(page, "dashboard");
  await page
    .getByRole("navigation", { name: "Разделы" })
    .getByRole("link", { name: "Инциденты" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Журнал инцидентов" }),
  ).toBeVisible();
  await shot(page, "incidents");
});
