import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
export const categories = {
  study: "Учёба",
  work: "Работа",
  personal: "Личное",
  health: "Здоровье",
  household: "Быт",
  language: "Языки",
  leisure: "Отдых",
} as const;
export const statuses = {
  todo: "Запланировано",
  partial: "Частично",
  done: "Готово",
  skipped: "Пропущено",
} as const;
export type Category = keyof typeof categories;
export type Status = keyof typeof statuses;
export type Recurrence = "none" | "daily" | "weekly";
export type Certainty = "confirmed" | "tentative" | "unknown";
export function localToday(
  timezone: string,
  now = Temporal.Now.instant(),
): string {
  return now.toZonedDateTimeISO(timezone).toPlainDate().toString();
}
export function addDays(date: string, amount: number): string {
  return Temporal.PlainDate.from(date).add({ days: amount }).toString();
}
export function weekDates(date: string): string[] {
  const d = Temporal.PlainDate.from(date);
  const start = d.subtract({ days: d.dayOfWeek - 1 });
  return Array.from({ length: 7 }, (_, i) => start.add({ days: i }).toString());
}
export function dateLabel(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
  },
): string {
  return new Intl.DateTimeFormat("ru-RU", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}
export function toInstant(
  date: string,
  time: string,
  timezone: string,
): string {
  const value = Temporal.PlainDateTime.from(`${date}T${time}`);
  return value
    .toZonedDateTime(timezone, { disambiguation: "reject" })
    .toInstant()
    .toString();
}
export function localDateTime(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}
export function clock(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainTime()
    .toString({ smallestUnit: "minute" });
}
export function endAfter(start: string, minutes: number): string {
  return Temporal.Instant.from(start).add({ minutes }).toString();
}
export function intervalOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string },
): boolean {
  return (
    Date.parse(a.start) < Date.parse(b.end) &&
    Date.parse(b.start) < Date.parse(a.end)
  );
}
const date = z.string().refine((v) => {
  try {
    return Temporal.PlainDate.from(v).toString() === v;
  } catch {
    return false;
  }
}, "Некорректная дата");
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Некорректное время");
export const itemFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Введите название")
      .max(200, "Название — до 200 символов"),
    description: z.string().trim().max(3000),
    category: z.enum([
      "study",
      "work",
      "personal",
      "health",
      "household",
      "language",
      "leisure",
    ]),
    date,
    time: z.union([time, z.literal("")]),
    end_date: date,
    end_time: z.union([time, z.literal("")]),
    estimated_minutes: z.number().int().min(5).max(720),
    priority: z.number().int().min(1).max(3),
    due_local: z.string(),
    due_mode: z.enum(["date", "datetime"]),
    due_certainty: z.enum(["confirmed", "tentative", "unknown"]),
    optional: z.boolean(),
    fixed: z.boolean(),
    recurrence: z.enum(["none", "daily", "weekly"]),
    repeat_until: z.union([date, z.literal("")]),
  })
  .superRefine((v, c) => {
    if (
      v.recurrence !== "none" &&
      (!v.repeat_until ||
        v.repeat_until < v.date ||
        v.repeat_until > addDays(v.date, 366))
    )
      c.addIssue({
        code: "custom",
        message: "Укажите окончание повторений не позднее чем через год",
        path: ["repeat_until"],
      });
    if (v.due_local) {
      try {
        if (v.due_mode === "date") Temporal.PlainDate.from(v.due_local);
        else Temporal.PlainDateTime.from(v.due_local);
      } catch {
        c.addIssue({
          code: "custom",
          message: "Некорректный срок",
          path: ["due_local"],
        });
      }
    }
    if (v.due_local && v.due_certainty === "unknown")
      c.addIssue({
        code: "custom",
        message:
          "Для указанного срока выберите подтверждённый или предварительный статус",
        path: ["due_certainty"],
      });
    if (!v.due_local && v.due_certainty !== "unknown")
      c.addIssue({
        code: "custom",
        message: "Укажите срок или выберите «Срок неизвестен»",
        path: ["due_local"],
      });
  });
export type ItemForm = z.infer<typeof itemFormSchema>;
export function defaultItemForm(date: string): ItemForm {
  return {
    title: "",
    description: "",
    category: "personal",
    date,
    time: "",
    end_date: date,
    end_time: "",
    estimated_minutes: 30,
    priority: 2,
    due_local: "",
    due_mode: "date",
    due_certainty: "unknown",
    optional: false,
    fixed: true,
    recurrence: "none",
    repeat_until: "",
  };
}
export function validateSchedule(
  form: ItemForm,
  kind: "task" | "event",
  timezone: string,
): { start: string | null; end: string | null; due: string | null } {
  const start = form.time ? toInstant(form.date, form.time, timezone) : null;
  const end =
    kind === "event"
      ? form.end_time
        ? toInstant(form.end_date, form.end_time, timezone)
        : null
      : start
        ? endAfter(start, form.estimated_minutes)
        : null;
  if (
    kind === "event" &&
    (!start || !end || Date.parse(end) <= Date.parse(start))
  )
    throw new Error(
      "Для события укажите начало и окончание; окончание должно быть позже начала.",
    );
  if (start && end && Date.parse(end) - Date.parse(start) > 86400000)
    throw new Error("Один блок не должен длиться больше суток.");
  let due = null;
  if (form.due_local && form.due_mode === "datetime") {
    const [d, t] = form.due_local.split("T");
    due = toInstant(d, t, timezone);
  }
  return { start, end, due };
}
export type Task = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: Category;
  priority: number;
  due_at: string | null;
  due_date: string | null;
  due_certainty: Certainty;
  estimated_minutes: number;
  optional: boolean;
  start_date: string;
  preferred_time: string | null;
  timezone: string;
  recurrence: Recurrence;
  repeat_until: string | null;
  archived: boolean;
  version: number;
};
export type TaskOccurrence = {
  id: string;
  task_id: string;
  user_id: string;
  source_date: string;
  local_date: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_minutes: number;
  status: Status;
  completion_note: string;
  skip_reason: string;
  version: number;
};
export type CalendarEvent = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: Category;
  fixed: boolean;
  start_at: string;
  end_at: string;
  timezone: string;
  recurrence: Recurrence;
  repeat_until: string | null;
  archived: boolean;
  version: number;
};
export type EventOccurrence = {
  id: string;
  event_id: string;
  user_id: string;
  source_date: string;
  local_date: string;
  start_at: string;
  end_at: string;
  status: Status;
  completion_note: string;
  version: number;
};
export type DayItem = {
  key: string;
  kind: "task" | "event";
  title: string;
  description: string;
  category: Category;
  optional: boolean;
  fixed: boolean;
  start: string | null;
  end: string | null;
  status: Status;
  date: string;
  task?: Task;
  event?: CalendarEvent;
  occurrence: TaskOccurrence | EventOccurrence;
};
export function dayItems(
  tasks: Task[],
  occurrences: TaskOccurrence[],
  events: CalendarEvent[],
  eventOccurrences: EventOccurrence[],
): DayItem[] {
  const ts = new Map(tasks.filter((t) => !t.archived).map((t) => [t.id, t])),
    es = new Map(events.filter((e) => !e.archived).map((e) => [e.id, e]));
  return [
    ...occurrences.flatMap((o) => {
      const t = ts.get(o.task_id);
      return t
        ? [
            {
              key: o.id,
              kind: "task" as const,
              title: t.title,
              description: t.description,
              category: t.category,
              optional: t.optional,
              fixed: false,
              start: o.planned_start,
              end: o.planned_end,
              status: o.status,
              date: o.local_date,
              task: t,
              occurrence: o,
            },
          ]
        : [];
    }),
    ...eventOccurrences.flatMap((o) => {
      const e = es.get(o.event_id);
      return e
        ? [
            {
              key: o.id,
              kind: "event" as const,
              title: e.title,
              description: e.description,
              category: e.category,
              optional: false,
              fixed: e.fixed,
              start: o.start_at,
              end: o.end_at,
              status: o.status,
              date: o.local_date,
              event: e,
              occurrence: o,
            },
          ]
        : [];
    }),
  ].sort(
    (a, b) =>
      (a.start || "9999").localeCompare(b.start || "9999") ||
      a.title.localeCompare(b.title, "ru"),
  );
}
export function conflicts(items: DayItem[]): [DayItem, DayItem][] {
  const active = items.filter(
    (i) => i.start && i.end && i.status !== "skipped",
  );
  const pairs: [DayItem, DayItem][] = [];
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++)
      if (
        intervalOverlap(
          { start: active[i].start!, end: active[i].end! },
          { start: active[j].start!, end: active[j].end! },
        )
      )
        pairs.push([active[i], active[j]]);
  return pairs;
}
export function completion(items: DayItem[]): { done: number; total: number } {
  const required = items.filter((i) => i.kind === "task" && !i.optional);
  return {
    done: required.filter((i) => i.status === "done").length,
    total: required.length,
  };
}
export function occursOn(
  start: string,
  cadence: Recurrence,
  until: string | null,
  date: string,
): boolean {
  if (date < start || (until && date > until)) return false;
  return cadence === "none"
    ? date === start
    : cadence === "daily" ||
        Temporal.PlainDate.from(start).dayOfWeek ===
          Temporal.PlainDate.from(date).dayOfWeek;
}

export function dayBounds(
  date: string,
  timezone: string,
): { start: number; end: number } {
  const d = Temporal.PlainDate.from(date);
  return {
    start: Number(d.toZonedDateTime(timezone).epochMilliseconds),
    end: Number(d.add({ days: 1 }).toZonedDateTime(timezone).epochMilliseconds),
  };
}

export function deadlineLabel(task: Task, timezone: string): string {
  if (task.due_at)
    return (
      dateLabel(localDateTime(task.due_at, timezone).slice(0, 10)) +
      ", " +
      clock(task.due_at, timezone)
    );
  return task.due_date
    ? dateLabel(task.due_date) + " · точное время неизвестно"
    : "Срок неизвестен";
}
export function deadlineOrder(task: Task): string {
  return task.due_at || task.due_date || "9999";
}
export function overdue(task: Task, timezone: string): boolean {
  return task.due_at
    ? Date.parse(task.due_at) < Date.now()
    : !!task.due_date && task.due_date < localToday(timezone);
}
