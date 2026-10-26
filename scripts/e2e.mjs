// Isolated integration harness: real local PostgreSQL, test-only auth transport.
// This verifies UI + SQL integration; it does NOT verify Supabase's hosted Auth.
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:3130",
  api = "http://127.0.0.1:3131";
const ids = {
  a: "00000000-0000-4000-8000-000000000001",
  b: "00000000-0000-4000-8000-000000000002",
};
const db = new PGlite();
const fns = {
  ensure_planner_occurrences: ["p_from", "p_to"],
  save_planner_task: [
    "p_task",
    "p_occurrence",
    "p_task_version",
    "p_occurrence_version",
  ],
  save_planner_event: [
    "p_event",
    "p_occurrence",
    "p_event_version",
    "p_occurrence_version",
    "p_confirm_fixed",
  ],
  set_planner_status: [
    "p_kind",
    "p_id",
    "p_version",
    "p_status",
    "p_actual_minutes",
    "p_note",
    "p_skip_reason",
  ],
  archive_planner_item: [
    "p_kind",
    "p_id",
    "p_version",
    "p_archived",
    "p_confirm_fixed",
  ],
};
function user(id) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: (id === ids.a ? "a" : "b") + "@example.test",
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    app_metadata: { provider: "email" },
    user_metadata: {},
  };
}
function token(id) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: id,
        role: "authenticated",
        aud: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    "fixture",
  ].join(".");
}
let failNextMutation = false;
const apiServer = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  try {
    const url = new URL(req.url, api);
    let text = "";
    for await (const part of req) text += part;
    const body = text ? JSON.parse(text) : {};
    if (url.pathname === "/auth/v1/token") {
      const id = body.email === "b@example.test" ? ids.b : ids.a;
      res.end(
        JSON.stringify({
          access_token: token(id),
          refresh_token: "fixture-refresh",
          token_type: "bearer",
          expires_in: 3600,
          user: user(id),
        }),
      );
      return;
    }
    if (url.pathname === "/auth/v1/logout") {
      res.end("{}");
      return;
    }
    let id;
    try {
      id = JSON.parse(
        Buffer.from(
          (req.headers.authorization || "").split(".")[1],
          "base64url",
        ).toString(),
      ).sub;
    } catch {}
    if (!Object.values(ids).includes(id)) {
      res.writeHead(401);
      res.end(JSON.stringify({ message: "Test session required" }));
      return;
    }
    if (url.pathname === "/auth/v1/user") {
      res.end(JSON.stringify(user(id)));
      return;
    }
    if (
      req.method === "POST" &&
      failNextMutation &&
      !url.pathname.includes("ensure_planner")
    ) {
      failNextMutation = false;
      res.writeHead(503);
      res.end(JSON.stringify({ message: "Fixture: network unavailable" }));
      return;
    }
    const result = await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        id,
      ]);
      await tx.exec("set local role authenticated");
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.split("/").at(-1);
        if (!fns[fn]) throw new Error("Unknown RPC");
        const params = fns[fn].map((k) => body[k] ?? null);
        return (
          await tx.query(
            `select public.${fn}(${params.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
            params,
          )
        ).rows[0].result;
      }
      const table = url.pathname.split("/").at(-1);
      if (
        ![
          "profiles",
          "tasks",
          "task_occurrences",
          "calendar_events",
          "event_occurrences",
        ].includes(table)
      )
        throw new Error("Unknown table");
      if (req.method !== "GET") throw new Error("Unsupported fixture request");
      const conditions = [],
        args = [];
      for (const [key, val] of url.searchParams) {
        if (["select", "order", "offset", "limit"].includes(key)) continue;
        if (!["user_id", "local_date", "id", "version"].includes(key))
          throw new Error("Unknown filter");
        const [op, ...rest] = val.split(".");
        const operator = { eq: "=", gte: ">=", lte: "<=" }[op];
        if (!operator) throw new Error("Unknown operator");
        args.push(rest.join("."));
        conditions.push(`${key}${operator}$${args.length}`);
      }
      const result = await tx.query(
        `select * from public.${table}${conditions.length ? " where " + conditions.join(" and ") : ""}${table === "profiles" ? "" : " order by id"}`,
        args,
      );
      return (req.headers.accept || "").includes("vnd.pgrst.object")
        ? result.rows[0] || null
        : result.rows;
    });
    res.end(
      JSON.stringify(result, (key, value) =>
        [
          "source_date",
          "local_date",
          "start_date",
          "due_date",
          "repeat_until",
        ].includes(key) && typeof value === "string"
          ? value.slice(0, 10)
          : value,
      ),
    );
  } catch (e) {
    res.writeHead(e.code === "40001" ? 409 : 400);
    res.end(
      JSON.stringify({ code: e.code || "TEST_ERROR", message: e.message }),
    );
  }
});
let activePage,
  next,
  browser,
  logs = "";
try {
  await db.exec(
    "create schema auth;create role anon;create role authenticated;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const name of ["202610260001_profiles.sql", "202610260002_planner.sql"])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  await db.query(
    "insert into auth.users(id) values($1),($2)",
    Object.values(ids),
  );
  await new Promise((resolve, reject) => {
    apiServer.once("error", reject);
    apiServer.listen(3131, "127.0.0.1", resolve);
  });
  next = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3130",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        LIFEOS_BUILD_DIR: ".next-e2e",
        NEXT_PUBLIC_SUPABASE_URL: api,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
      },
    },
  );
  next.stdout.on("data", (d) => {
    logs = (logs + d).slice(-10000);
  });
  next.stderr.on("data", (d) => {
    logs = (logs + d).slice(-10000);
  });
  for (let i = 0; i < 120; i++) {
    if (next.exitCode !== null)
      throw new Error("Next test server stopped: " + logs);
    try {
      const r = await fetch(origin);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
    if (i === 119) throw new Error("Next test server not ready: " + logs);
  }
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  activePage = page;
  async function signIn(page, email) {
    await page.goto(origin);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.getByRole("button", { name: "+ Задача", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "+ Задача", exact: true })
      .waitFor({ state: "visible" });
  }
  await signIn(page, "a@example.test");
  await page.getByLabel("Выбранный день", { exact: true }).fill("2026-10-27");
  const add = page.getByRole("button", { name: "+ Задача", exact: true });
  await add.waitFor();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "+ Задача",
      )?.disabled,
  );
  await add.click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Название", { exact: true })
    .fill("Подготовить семинар");
  await dialog
    .getByLabel("Начало (необязательно)", { exact: true })
    .fill("16:00");
  await dialog
    .getByRole("button", { name: "Сохранить в облаке", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  let row = page.locator(".agenda-item").filter({
    has: page.getByRole("heading", {
      name: "Подготовить семинар",
      exact: true,
    }),
  });
  await row.waitFor();
  await row.getByRole("button", { name: "Готово", exact: true }).click();
  await row
    .getByRole("button", { name: "Отменить выполнение", exact: true })
    .waitFor();
  await row
    .getByRole("button", { name: "Отменить выполнение", exact: true })
    .click();
  await row.getByRole("button", { name: "Готово", exact: true }).waitFor();
  await row.getByRole("button", { name: "Статус / итог", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Статус", { exact: true }).selectOption("partial");
  await dialog
    .getByLabel("Фактически потрачено, мин", { exact: true })
    .fill("15");
  await dialog
    .getByRole("button", { name: "Сохранить итог", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await row.getByText("Частично", { exact: true }).waitFor();
  await page.reload();
  await row.waitFor();
  await row.getByText("Фактически: 15 мин", { exact: true }).waitFor();
  await row
    .getByRole("button", { name: "Изменить / перенести", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Дата", { exact: true }).fill("2026-10-28");
  await dialog
    .getByRole("button", { name: "Сохранить в облаке", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await row.waitFor();
  await page.getByRole("button", { name: "+ Событие", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Название", { exact: true })
    .fill("Фиксированное занятие");
  await dialog.getByLabel("Начало", { exact: true }).fill("16:00");
  await dialog.getByLabel("Окончание", { exact: true }).fill("17:00");
  await dialog.getByLabel("Сохранить пересечение осознанно").check();
  await dialog
    .getByRole("button", { name: "Сохранить в облаке", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: "Есть пересечения", exact: true })
    .waitFor();
  const event = page.locator(".agenda-item").filter({
    has: page.getByRole("heading", {
      name: "Фиксированное занятие",
      exact: true,
    }),
  });
  await event
    .getByRole("button", { name: "Изменить / перенести", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Начало", { exact: true }).fill("18:00");
  await dialog.getByLabel("Окончание", { exact: true }).fill("19:00");
  await dialog
    .getByRole("button", { name: "Сохранить в облаке", exact: true })
    .click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Подтвердите изменение" })
    .waitFor();
  await dialog
    .getByLabel("Подтверждаю изменение закреплённого события")
    .check();
  await dialog
    .getByRole("button", { name: "Сохранить в облаке", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  // Two simultaneous devices retain edits rather than silently overwriting.
  const second = await browser.newContext({
    viewport: { width: 360, height: 800 },
  });
  const phone = await second.newPage();
  await signIn(phone, "a@example.test");
  await phone.getByLabel("Выбранный день", { exact: true }).fill("2026-10-28");
  const phoneRow = phone.locator(".agenda-item").filter({
    has: phone.getByRole("heading", {
      name: "Подготовить семинар",
      exact: true,
    }),
  });
  await phoneRow.waitFor();
  await phoneRow
    .getByRole("button", { name: "Изменить / перенести", exact: true })
    .click();
  const phoneDialog = phone.getByRole("dialog");
  await phoneDialog
    .getByLabel("Название", { exact: true })
    .fill("Телефон: новая редакция");
  await row
    .getByRole("button", { name: "Изменить / перенести", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Название", { exact: true })
    .fill("Компьютер: новая редакция");
  await dialog
    .getByRole("button", { name: "Сохранить в облаке", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await phoneDialog
    .getByRole("button", { name: "Сохранить в облаке", exact: true })
    .click();
  await phoneDialog
    .getByRole("alert")
    .filter({ hasText: "другом устройстве" })
    .waitFor();
  assert.equal(
    await phoneDialog.getByLabel("Название", { exact: true }).inputValue(),
    "Телефон: новая редакция",
  );
  await phoneDialog
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  await phone.getByRole("button", { name: "↻ Обновить", exact: true }).click();
  await phone
    .getByRole("heading", { name: "Компьютер: новая редакция", exact: true })
    .waitFor();
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await mkdir("test-results", { recursive: true });
  await phone.screenshot({
    path: "test-results/planner-360.png",
    fullPage: true,
  });
  await page.screenshot({
    path: "test-results/planner-desktop.png",
    fullPage: true,
  });
  // Lookups for a different week detect conflicts before a cross-week move.
  await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      ids.a,
    ]);
    await tx.query("select public.save_planner_event($1,$2,null,null,false)", [
      {
        title: "Будущее занятие",
        description: "",
        category: "study",
        fixed: true,
        timezone: "Europe/Moscow",
        recurrence: "none",
        repeat_until: null,
      },
      {
        local_date: "2026-11-04",
        start_at: "2026-11-04T15:00Z",
        end_at: "2026-11-04T16:00Z",
      },
    ]);
  });
  await add.click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Название", { exact: true })
    .fill("Перенос на другую неделю");
  await dialog.getByLabel("Дата", { exact: true }).fill("2026-11-04");
  await dialog
    .getByLabel("Начало (необязательно)", { exact: true })
    .fill("18:00");
  await dialog
    .getByText("Пересекается с: Будущее занятие.", { exact: true })
    .waitFor();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  // Mobile bottom navigation works, including the More menu.
  await phone.getByRole("button", { name: "Ещё", exact: true }).click();
  await phone
    .getByRole("navigation", { name: "Другие разделы" })
    .getByRole("button", { name: "Языки", exact: true })
    .click();
  await phone.getByRole("heading", { name: "Языки", exact: true }).waitFor();
  await phone
    .getByRole("navigation", { name: "Мобильная навигация" })
    .getByRole("button", { name: "Сегодня", exact: true })
    .click();
  await phone
    .getByRole("heading", { name: "Лента дня", exact: true })
    .waitFor();
  // Failed save stays in editor and does not report success.
  await add.click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Название", { exact: true })
    .fill("Не должно сохраниться");
  failNextMutation = true;
  await dialog
    .getByRole("button", { name: "Сохранить в облаке", exact: true })
    .click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "network unavailable" })
    .waitFor();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  // A separate user never sees A's records through the same UI.
  const other = await browser.newContext();
  const userB = await other.newPage();
  await signIn(userB, "b@example.test");
  await userB.getByLabel("Выбранный день", { exact: true }).fill("2026-10-28");
  await userB
    .getByText("Нет предстоящих блоков на выбранный день.", { exact: true })
    .waitFor();
  assert.equal(await userB.locator(".agenda-item").count(), 0);
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await page
    .getByRole("heading", { name: "Ваша неделя", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "День", exact: true }).click();
  await page.getByRole("heading", { name: "Лента дня", exact: true }).waitFor();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.getByRole("button", { name: "Войти", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real local SQL + browser: login fixture, task CRUD/move/status/reload, fixed events, overlaps, two-device CAS, failed-save handling, two-user isolation, 360px, navigation, logout. Hosted Supabase Auth not tested.",
  );
} catch (e) {
  if (activePage) {
    await mkdir("test-results", { recursive: true });
    await activePage
      .screenshot({ path: "test-results/failure.png", fullPage: true })
      .catch(() => {});
    console.error(await activePage.locator("dialog").allTextContents());
  }
  console.error(e);
  console.error(logs);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (next) {
    next.kill("SIGTERM");
    await new Promise((resolve) => {
      if (next.exitCode !== null) resolve();
      else {
        next.once("exit", resolve);
        setTimeout(() => {
          next.kill("SIGKILL");
          resolve();
        }, 5000).unref();
      }
    });
  }
  await new Promise((resolve) => apiServer.close(resolve));
  await db.close();
}
