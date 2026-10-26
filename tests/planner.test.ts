import { test } from "node:test";
import assert from "node:assert/strict";
import { Temporal } from "@js-temporal/polyfill";
import {
  addDays,
  weekDates,
  localToday,
  toInstant,
  localDateTime,
  dayBounds,
  intervalOverlap,
  occursOn,
  completion,
  defaultItemForm,
  itemFormSchema,
  validateSchedule,
  conflicts,
  type DayItem,
} from "../lib/planner";
test("Moscow local date differs from UTC across midnight", () => {
  assert.equal(
    localToday("Europe/Moscow", Temporal.Instant.from("2026-10-26T22:00:00Z")),
    "2026-10-27",
  );
  assert.equal(
    toInstant("2026-10-27", "06:00", "Europe/Moscow"),
    "2026-10-27T03:00:00Z",
  );
  assert.equal(
    localDateTime("2026-10-27T03:00:00Z", "Europe/Moscow"),
    "2026-10-27T06:00",
  );
});
test("DST nonexistent and ambiguous local times rejected; day lengths are real", () => {
  assert.throws(() => toInstant("2026-03-29", "02:30", "Europe/Berlin"));
  assert.throws(() => toInstant("2026-10-25", "02:30", "Europe/Berlin"));
  const spring = dayBounds("2026-03-29", "Europe/Berlin"),
    fall = dayBounds("2026-10-25", "Europe/Berlin");
  assert.equal((spring.end - spring.start) / 3600000, 23);
  assert.equal((fall.end - fall.start) / 3600000, 25);
});
test("weeks cross month/year boundaries; daily and weekly recurrences are bounded", () => {
  assert.deepEqual(weekDates("2027-01-01"), [
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]);
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(
    occursOn("2026-10-27", "weekly", "2026-11-10", "2026-11-03"),
    true,
  );
  assert.equal(
    occursOn("2026-10-27", "weekly", "2026-11-10", "2026-11-04"),
    false,
  );
  assert.equal(
    occursOn("2026-10-27", "daily", "2026-11-10", "2026-11-11"),
    false,
  );
  assert.equal(occursOn("2026-10-27", "none", null, "2026-10-28"), false);
});
test("adjacent intervals are not conflicts; overlapping intervals are", () => {
  assert.equal(
    intervalOverlap(
      { start: "2026-10-27T08:00Z", end: "2026-10-27T09:00Z" },
      { start: "2026-10-27T09:00Z", end: "2026-10-27T10:00Z" },
    ),
    false,
  );
  assert.equal(
    intervalOverlap(
      { start: "2026-10-27T08:00Z", end: "2026-10-27T09:01Z" },
      { start: "2026-10-27T09:00Z", end: "2026-10-27T10:00Z" },
    ),
    true,
  );
});
test("partial and optional completion do not inflate mandatory KPI", () => {
  const items = [
    { kind: "task", optional: false, status: "partial" },
    { kind: "task", optional: true, status: "skipped" },
    { kind: "task", optional: false, status: "done" },
    { kind: "event", optional: false, status: "done" },
  ] as DayItem[];
  assert.deepEqual(completion(items), { done: 1, total: 2 });
});
test("forms reject invalid dates, unknown deadline marked confirmed, and unbounded recurrence", () => {
  const valid = { ...defaultItemForm("2026-10-27"), title: "МИР" };
  assert.equal(itemFormSchema.safeParse(valid).success, true);
  for (const patch of [
    { date: "2026-02-30" },
    { due_certainty: "confirmed" },
    { recurrence: "daily", repeat_until: "" },
    { recurrence: "weekly", repeat_until: "2028-10-27" },
  ])
    assert.equal(
      itemFormSchema.safeParse({ ...valid, ...patch }).success,
      false,
    );
});
test("scheduled tasks get explicit duration; tentative deadline preserves certainty", () => {
  const form = {
    ...defaultItemForm("2026-10-27"),
    title: "Учёба",
    time: "16:00",
    estimated_minutes: 45,
    due_local: "2026-11-02T12:00",
    due_mode: "datetime" as const,
    due_certainty: "tentative" as const,
  };
  assert.equal(itemFormSchema.parse(form).due_certainty, "tentative");
  assert.deepEqual(validateSchedule(form, "task", "Europe/Moscow"), {
    start: "2026-10-27T13:00:00Z",
    end: "2026-10-27T13:45:00Z",
    due: "2026-11-02T09:00:00Z",
  });
  assert.throws(() =>
    validateSchedule({ ...form, end_time: "15:00" }, "event", "Europe/Moscow"),
  );
});

test("date-only tentative deadlines do not invent a time", () => {
  const form = {
    ...defaultItemForm("2026-10-27"),
    title: "Проверка",
    due_local: "2026-11-02",
    due_mode: "date" as const,
    due_certainty: "tentative" as const,
  };
  assert.equal(itemFormSchema.parse(form).due_certainty, "tentative");
  assert.equal(validateSchedule(form, "task", "Europe/Moscow").due, null);
});
