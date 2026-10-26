import { supabase } from "./supabase";
import {
  addDays,
  type Task,
  type TaskOccurrence,
  type CalendarEvent,
  type EventOccurrence,
  type DayItem,
  type ItemForm,
  validateSchedule,
} from "./planner";
export type PlannerData = {
  tasks: Task[];
  occurrences: TaskOccurrence[];
  events: CalendarEvent[];
  eventOccurrences: EventOccurrence[];
};
async function rows<T>(
  table: string,
  from?: string,
  to?: string,
): Promise<T[]> {
  if (!supabase) throw new Error("Supabase не подключён");
  const result: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabase
      .from(table)
      .select("*")
      .order("id")
      .range(offset, offset + 499);
    if (from && to) query = query.gte("local_date", from).lte("local_date", to);
    const { data, error } = await query;
    if (error) throw error;
    result.push(...(data as T[]));
    if (data.length < 500) break;
  }
  return result;
}
export function friendlyError(error: unknown): string {
  const value = error as { code?: string; message?: string };
  if (value.code === "40001")
    return "Запись изменена на другом устройстве. Ваши правки не применены. Обновите данные, закройте форму и откройте запись заново.";
  if (
    value.code === "PGRST202" ||
    value.code === "42P01" ||
    value.code === "PGRST205"
  )
    return "Нужно обновить базу: выполните миграцию 202610260002_planner.sql в Supabase → SQL Editor. Профиль и существующие записи сохранятся.";
  if (/DST|multiple instants|no such instant/i.test(value.message || ""))
    return "Это время неоднозначно или отсутствует из-за перевода часов. Выберите другое время.";
  return (
    value.message ||
    "Не удалось связаться с облаком. Проверьте подключение и повторите."
  );
}
export async function loadPlanner(
  from: string,
  to: string,
): Promise<PlannerData> {
  if (!supabase) throw new Error("Supabase не подключён");
  const lo = addDays(from, -2),
    hi = addDays(to, 2);
  const { error } = await supabase.rpc("ensure_planner_occurrences", {
    p_from: lo,
    p_to: hi,
  });
  if (error) throw error;
  const [tasks, occurrences, events, eventOccurrences] = await Promise.all([
    rows<Task>("tasks"),
    rows<TaskOccurrence>("task_occurrences", lo, hi),
    rows<CalendarEvent>("calendar_events"),
    rows<EventOccurrence>("event_occurrences", lo, hi),
  ]);
  return { tasks, occurrences, events, eventOccurrences };
}
export async function saveItem(
  kind: "task" | "event",
  form: ItemForm,
  timezone: string,
  original: DayItem | null,
  confirmFixed: boolean,
) {
  if (!supabase) throw new Error("Supabase не подключён");
  const { start, end, due } = validateSchedule(form, kind, timezone);
  if (kind === "task") {
    const task = {
      ...(original?.task ? { id: original.task.id } : {}),
      title: form.title,
      description: form.description,
      category: form.category,
      priority: form.priority,
      due_at: due,
      due_date:
        form.due_mode === "date" && form.due_local ? form.due_local : null,
      due_certainty: form.due_certainty,
      estimated_minutes: form.estimated_minutes,
      optional: form.optional,
      timezone,
      recurrence: form.recurrence,
      repeat_until: form.recurrence === "none" ? null : form.repeat_until,
    };
    const occurrence = {
      ...(original ? { id: original.occurrence.id } : {}),
      local_date: form.date,
      planned_start: start,
      planned_end: end,
    };
    const { error } = await supabase.rpc("save_planner_task", {
      p_task: task,
      p_occurrence: occurrence,
      p_task_version: original?.task?.version ?? null,
      p_occurrence_version: original?.occurrence.version ?? null,
    });
    if (error) throw error;
  } else {
    const event = {
      ...(original?.event ? { id: original.event.id } : {}),
      title: form.title,
      description: form.description,
      category: form.category,
      fixed: form.fixed,
      timezone,
      recurrence: form.recurrence,
      repeat_until: form.recurrence === "none" ? null : form.repeat_until,
    };
    const occurrence = {
      ...(original ? { id: original.occurrence.id } : {}),
      local_date: form.date,
      start_at: start,
      end_at: end,
    };
    const { error } = await supabase.rpc("save_planner_event", {
      p_event: event,
      p_occurrence: occurrence,
      p_event_version: original?.event?.version ?? null,
      p_occurrence_version: original?.occurrence.version ?? null,
      p_confirm_fixed: confirmFixed,
    });
    if (error) throw error;
  }
}
