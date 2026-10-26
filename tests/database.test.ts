import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002";
const task = {
  title: "Тест",
  description: "",
  category: "study",
  priority: 1,
  due_at: null,
  due_certainty: "unknown",
  estimated_minutes: 30,
  optional: false,
  timezone: "Europe/Moscow",
  recurrence: "none",
  repeat_until: null,
};
const occurrence = {
  local_date: "2026-10-27",
  planned_start: "2026-10-27T13:00:00Z",
  planned_end: "2026-10-27T13:30:00Z",
};
test("PostgreSQL migrations, RLS, CRUD, CAS, recurrence and fixed-event protection", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(
      `create schema auth;create role anon;create role authenticated;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    const migrations = await Promise.all(
      ["202610260001_profiles.sql", "202610260002_planner.sql"].map((f) =>
        readFile(
          new URL("../supabase/migrations/" + f, import.meta.url),
          "utf8",
        ),
      ),
    );
    for (const m of migrations) await db.exec(m);
    for (const m of migrations) await db.exec(m); // repeatability
    await db.query("insert into auth.users(id) values($1),($2)", [A, B]);
    async function asUser(id: string) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    }
    async function rpc<T = Record<string, unknown>>(
      fn: string,
      args: unknown[],
    ) {
      return (
        await db.query<{ result: T }>(
          `select public.${fn}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
          args,
        )
      ).rows[0].result;
    }
    await asUser(A);
    type SavedTask = {
      task: typeof task & { id: string; version: number };
      occurrence: typeof occurrence & {
        id: string;
        version: number;
        status: string;
        actual_minutes: number;
      };
    };
    const saved = await rpc<SavedTask>("save_planner_task", [
      task,
      occurrence,
      null,
      null,
    ]);
    await t.test(
      "own profile and task readable, cross-user rows absent",
      async () => {
        assert.equal(
          (await db.query("select * from public.profiles")).rows.length,
          1,
        );
        assert.equal(
          (await db.query("select * from public.tasks")).rows.length,
          1,
        );
        await asUser(B);
        assert.equal(
          (await db.query("select * from public.tasks")).rows.length,
          0,
        );
        await assert.rejects(
          rpc("save_planner_task", [
            { ...task, id: saved.task.id },
            { ...occurrence, id: saved.occurrence.id },
            1,
            1,
          ]),
          /Conflict/,
        );
        await assert.rejects(
          rpc("set_planner_status", [
            "task",
            saved.occurrence.id,
            1,
            "done",
            0,
            "",
            "",
          ]),
          /Conflict/,
        );
        await assert.rejects(
          rpc("archive_planner_item", ["task", saved.task.id, 1, true, false]),
          /Conflict/,
        );
        await assert.rejects(
          db.query("update public.tasks set title=$1 where id=$2", [
            "hacked",
            saved.task.id,
          ]),
          /permission denied/,
        );
        await asUser(A);
        assert.equal(
          (await db.query<{ title: string }>("select title from public.tasks"))
            .rows[0].title,
          "Тест",
        );
      },
    );
    await t.test(
      "atomic edit rolls back template when occurrence version is stale",
      async () => {
        await assert.rejects(
          rpc("save_planner_task", [
            { ...task, id: saved.task.id, title: "Must rollback" },
            { ...occurrence, id: saved.occurrence.id },
            1,
            999,
          ]),
          /Conflict/,
        );
        const row = (
          await db.query<{ title: string; version: number }>(
            "select title,version from public.tasks",
          )
        ).rows[0];
        assert.equal(row.title, "Тест");
        assert.equal(row.version, 1);
      },
    );
    await t.test(
      "partial actual time, completion undo and stale version rejection",
      async () => {
        const partial = await rpc<{
          status: string;
          version: number;
          actual_minutes: number;
        }>("set_planner_status", [
          "task",
          saved.occurrence.id,
          1,
          "partial",
          15,
          "Прочитана часть",
          "",
        ]);
        assert.equal(partial.status, "partial");
        assert.equal(partial.actual_minutes, 15);
        await assert.rejects(
          rpc("set_planner_status", [
            "task",
            saved.occurrence.id,
            1,
            "done",
            30,
            "",
            "",
          ]),
          /Conflict/,
        );
        const done = await rpc<{ version: number }>("set_planner_status", [
          "task",
          saved.occurrence.id,
          partial.version,
          "done",
          30,
          "",
          "",
        ]);
        const undone = await rpc<{ status: string }>("set_planner_status", [
          "task",
          saved.occurrence.id,
          done.version,
          "todo",
          30,
          "",
          "",
        ]);
        assert.equal(undone.status, "todo");
      },
    );
    await t.test(
      "negative minutes, invalid intervals and unbounded recurrence rejected",
      async () => {
        await assert.rejects(
          rpc("save_planner_task", [
            task,
            { ...occurrence, planned_end: null },
            null,
            null,
          ]),
          /constraint/,
        );
        await assert.rejects(
          rpc("save_planner_task", [
            { ...task, recurrence: "daily" },
            occurrence,
            null,
            null,
          ]),
          /constraint/,
        );
        await assert.rejects(
          rpc("set_planner_status", [
            "task",
            saved.occurrence.id,
            4,
            "partial",
            -1,
            "",
            "",
          ]),
          /constraint/,
        );
      },
    );
    await t.test(
      "repeated generation is idempotent and moving an instance does not regenerate it",
      async () => {
        const repeated = await rpc<SavedTask>("save_planner_task", [
          {
            ...task,
            title: "weekly",
            recurrence: "weekly",
            repeat_until: "2026-11-10",
          },
          occurrence,
          null,
          null,
        ]);
        await rpc("ensure_planner_occurrences", ["2026-10-27", "2026-11-10"]);
        await rpc("ensure_planner_occurrences", ["2026-10-27", "2026-11-10"]);
        assert.equal(
          (
            await db.query(
              "select * from public.task_occurrences where task_id=$1",
              [repeated.task.id],
            )
          ).rows.length,
          3,
        );
        await rpc("save_planner_task", [
          { ...task, id: repeated.task.id },
          {
            ...occurrence,
            id: repeated.occurrence.id,
            local_date: "2026-10-28",
            planned_start: "2026-10-28T13:00Z",
            planned_end: "2026-10-28T13:30Z",
          },
          1,
          1,
        ]);
        await rpc("ensure_planner_occurrences", ["2026-10-27", "2026-11-10"]);
        const rows = (
          await db.query<{ source_date: string; local_date: string }>(
            "select source_date::text,local_date::text from public.task_occurrences where task_id=$1",
            [repeated.task.id],
          )
        ).rows;
        assert.equal(rows.length, 3);
        assert.equal(
          rows.filter((r) => r.local_date === "2026-10-27").length,
          0,
        );
      },
    );
    await t.test(
      "fixed events require explicit confirmation, including archival",
      async () => {
        const e = {
          title: "Учёба",
          description: "",
          category: "study",
          fixed: true,
          timezone: "Europe/Moscow",
          recurrence: "none",
          repeat_until: null,
        };
        const o = {
          local_date: "2026-10-27",
          start_at: "2026-10-27T05:45Z",
          end_at: "2026-10-27T11:20Z",
        };
        type E = {
          event: { id: string; version: number };
          occurrence: { id: string; version: number };
        };
        const created = await rpc<E>("save_planner_event", [
          e,
          o,
          null,
          null,
          false,
        ]);
        await assert.rejects(
          rpc("save_planner_event", [
            { ...e, id: created.event.id },
            { ...o, id: created.occurrence.id },
            1,
            1,
            false,
          ]),
          /confirmation/,
        );
        await assert.rejects(
          rpc("archive_planner_item", [
            "event",
            created.event.id,
            1,
            true,
            false,
          ]),
          /confirmation/,
        );
        const updated = await rpc<E>("save_planner_event", [
          { ...e, id: created.event.id },
          { ...o, id: created.occurrence.id, start_at: "2026-10-27T06:00Z" },
          1,
          1,
          true,
        ]);
        assert.equal(updated.event.version, 2);
        await asUser(B);
        assert.equal(
          (await db.query("select * from public.event_occurrences")).rows
            .length,
          0,
        );
        await assert.rejects(
          rpc("save_planner_event", [
            { ...e, id: created.event.id },
            { ...o, id: created.occurrence.id },
            2,
            2,
            true,
          ]),
          /Conflict/,
        );
        await asUser(A);
      },
    );
    await t.test(
      "DST helper rejects gaps/folds and accepts Moscow",
      async () => {
        await assert.rejects(
          rpc("lifeos_local_instant", ["2026-03-29", "02:30", "Europe/Berlin"]),
          /Nonexistent/,
        );
        await assert.rejects(
          rpc("lifeos_local_instant", ["2026-10-25", "02:30", "Europe/Berlin"]),
          /Ambiguous/,
        );
        const result = await rpc<Date>("lifeos_local_instant", [
          "2026-10-27",
          "06:00",
          "Europe/Moscow",
        ]);
        assert.equal(
          new Date(result).toISOString(),
          "2026-10-27T03:00:00.000Z",
        );
      },
    );
    await t.test(
      "archive and restore preserve original instances",
      async () => {
        await rpc("archive_planner_item", [
          "task",
          saved.task.id,
          1,
          true,
          false,
        ]);
        assert.equal(
          (
            await db.query<{ archived: boolean }>(
              "select archived from public.tasks where id=$1",
              [saved.task.id],
            )
          ).rows[0].archived,
          true,
        );
        await rpc("archive_planner_item", [
          "task",
          saved.task.id,
          2,
          false,
          false,
        ]);
        assert.equal(
          (
            await db.query(
              "select * from public.task_occurrences where task_id=$1",
              [saved.task.id],
            )
          ).rows.length,
          1,
        );
      },
    );

    await t.test(
      "date-only deadlines persist without a guessed timestamp",
      async () => {
        const result = await rpc<{
          task: { due_date: Date; due_at: null; due_certainty: string };
        }>("save_planner_task", [
          { ...task, due_date: "2026-11-02", due_certainty: "tentative" },
          occurrence,
          null,
          null,
        ]);
        assert.equal(
          new Date(result.task.due_date).toISOString().slice(0, 10),
          "2026-11-02",
        );
        assert.equal(result.task.due_at, null);
        assert.equal(result.task.due_certainty, "tentative");
      },
    );
    await t.test(
      "daily event recurrence survives repeated generation and a move",
      async () => {
        const e = {
          title: "Повтор",
          description: "",
          category: "personal",
          fixed: false,
          timezone: "Europe/Moscow",
          recurrence: "daily",
          repeat_until: "2026-10-29",
        };
        const o = {
          local_date: "2026-10-27",
          start_at: "2026-10-27T15:00Z",
          end_at: "2026-10-27T16:00Z",
        };
        const created = await rpc<{
          event: { id: string };
          occurrence: { id: string };
        }>("save_planner_event", [e, o, null, null, false]);
        await rpc("ensure_planner_occurrences", ["2026-10-27", "2026-10-30"]);
        await rpc("ensure_planner_occurrences", ["2026-10-27", "2026-10-30"]);
        assert.equal(
          (
            await db.query(
              "select * from public.event_occurrences where event_id=$1",
              [created.event.id],
            )
          ).rows.length,
          3,
        );
        await rpc("save_planner_event", [
          { ...e, id: created.event.id },
          {
            ...o,
            id: created.occurrence.id,
            local_date: "2026-10-30",
            start_at: "2026-10-30T15:00Z",
            end_at: "2026-10-30T16:00Z",
          },
          1,
          1,
          false,
        ]);
        await rpc("ensure_planner_occurrences", ["2026-10-27", "2026-10-30"]);
        const moved = (
          await db.query<{ source_date: string; local_date: string }>(
            "select source_date::text,local_date::text from public.event_occurrences where event_id=$1",
            [created.event.id],
          )
        ).rows;
        assert.equal(moved.length, 3);
        assert.equal(
          moved.find((v) => v.source_date === "2026-10-27")?.local_date,
          "2026-10-30",
        );
      },
    );
  } finally {
    await db.close();
  }
});
