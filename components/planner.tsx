"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  addDays,
  categories,
  clock,
  completion,
  conflicts,
  dateLabel,
  dayBounds,
  deadlineLabel,
  deadlineOrder,
  overdue,
  dayItems,
  defaultItemForm,
  itemFormSchema,
  localDateTime,
  localToday,
  statuses,
  validateSchedule,
  weekDates,
  type Category,
  type DayItem,
  type ItemForm,
  type Status,
  type TaskOccurrence,
} from "../lib/planner";
import {
  friendlyError,
  loadPlanner,
  saveItem,
  type PlannerData,
} from "../lib/planner-data";
type Props = {
  userId: string;
  timezone: string;
  name: string;
  section: string;
};
const empty: PlannerData = {
  tasks: [],
  occurrences: [],
  events: [],
  eventOccurrences: [],
};
function onDate(item: DayItem, date: string, timezone: string) {
  if (!item.start || !item.end) return item.date === date;
  const { start, end } = dayBounds(date, timezone);
  return Date.parse(item.start) < end && Date.parse(item.end) > start;
}
export default function Planner({ userId, timezone, name, section }: Props) {
  const [selected, setSelected] = useState(() => {
      const saved =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("date")
          : null;
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
        try {
          weekDates(saved);
          return saved;
        } catch {}
      }
      return localToday(timezone);
    }),
    [data, setData] = useState<PlannerData>(empty),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [synced, setSynced] = useState("");
  const [view, setView] = useState<"day" | "week">("week"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [filter, setFilter] = useState("all"),
    [archive, setArchive] = useState(false);
  const [editor, setEditor] = useState<{
      kind: "task" | "event";
      item: DayItem | null;
    } | null>(null),
    [statusItem, setStatusItem] = useState<DayItem | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("date", selected);
    window.history.replaceState(null, "", url);
  }, [selected]);
  const seq = useRef(0);
  const dates = useMemo(() => weekDates(selected), [selected]);
  const start = dates[0],
    end = dates[6];
  const reload = useCallback(async () => {
    const current = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const next = await loadPlanner(start, end);
      if (current === seq.current) {
        setData(next);
        setSynced(
          new Date().toLocaleTimeString("ru-RU", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      }
      return true;
    } catch (e) {
      if (current === seq.current) setError(friendlyError(e));
      return false;
    } finally {
      if (current === seq.current) setLoading(false);
    }
  }, [start, end, timezone, userId]);
  useEffect(() => {
    void reload();
    return () => {
      seq.current++;
    };
  }, [reload]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, [reload]);
  const all = useMemo(
    () =>
      dayItems(
        data.tasks,
        data.occurrences,
        data.events,
        data.eventOccurrences,
      ),
    [data],
  );
  const day = all.filter((i) => onDate(i, selected, timezone));
  const collisions = conflicts(day);
  const progress = completion(day);
  const filtered = (items: DayItem[]) =>
    items.filter(
      (i) =>
        (category === "all" || i.category === category) &&
        (filter === "all" || i.status === filter) &&
        i.title.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru")),
    );
  async function mutate(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await reload();
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function add(kind: "task" | "event") {
    setEditor({ kind, item: null });
    setMessage("");
  }
  async function quickDone(item: DayItem) {
    if (!supabase) return;
    await mutate(
      async () => {
        const { error } = await supabase!.rpc("set_planner_status", {
          p_kind: item.kind,
          p_id: item.occurrence.id,
          p_version: item.occurrence.version,
          p_status: item.status === "done" ? "todo" : "done",
          p_actual_minutes: item.task
            ? (item.occurrence as TaskOccurrence).actual_minutes
            : 0,
          p_note: item.occurrence.completion_note,
          p_skip_reason: item.task
            ? (item.occurrence as TaskOccurrence).skip_reason
            : "",
        });
        if (error) throw error;
      },
      item.status === "done"
        ? "Отметка отменена в облаке."
        : "Выполнение сохранено в облаке.",
    );
  }
  async function archiveItem(item: DayItem) {
    if (!supabase) return;
    const series = (item.task?.recurrence || item.event?.recurrence) !== "none";
    if (
      !confirm(
        `${item.fixed ? "Это фиксированное событие. " : ""}Отправить ${series ? "всю серию" : "запись"} «${item.title}» в архив? Её можно восстановить.`,
      )
    )
      return;
    await mutate(async () => {
      const { error } = await supabase!.rpc("archive_planner_item", {
        p_kind: item.kind,
        p_id: item.task?.id || item.event!.id,
        p_version: item.task?.version || item.event!.version,
        p_archived: true,
        p_confirm_fixed: item.fixed,
      });
      if (error) throw error;
    }, "Запись перемещена в архив.");
  }
  function card(item: DayItem) {
    return (
      <article
        className={`agenda-item ${item.status === "done" ? "is-done" : ""}`}
        key={item.key}
      >
        <div className="agenda-time">
          {item.start ? (
            <>
              <time>{clock(item.start, timezone)}</time>
              <small>
                {clock(item.end!, timezone)}
                {localDateTime(item.end!, timezone).slice(0, 10) !==
                localDateTime(item.start!, timezone).slice(0, 10)
                  ? " +1 день"
                  : ""}
              </small>
            </>
          ) : (
            <small>Без времени</small>
          )}
        </div>
        <div className="agenda-body">
          <div className="tags">
            <span>{categories[item.category]}</span>
            <span>{statuses[item.status]}</span>
            {item.fixed && <span>Закреплено</span>}
            {item.optional && <span>Необязательно</span>}
            {item.task?.priority === 1 && <span>Высокий приоритет</span>}
            {(item.task?.recurrence || item.event?.recurrence) !== "none" && (
              <span>Повторяется</span>
            )}
          </div>
          <h3>{item.title}</h3>
          {item.description && (
            <p className="item-description">{item.description}</p>
          )}
          {item.task && (item.task.due_at || item.task.due_date) && (
            <p
              className={`deadline ${overdue(item.task, timezone) && item.status !== "done" ? "late" : ""}`}
            >
              {item.task.due_certainty === "tentative"
                ? "Предварительный срок: "
                : "Срок: "}
              {deadlineLabel(item.task, timezone)}
            </p>
          )}
          {item.occurrence.completion_note && (
            <p className="muted">Итог: {item.occurrence.completion_note}</p>
          )}
          {item.task && (item.occurrence as TaskOccurrence).skip_reason && (
            <p className="muted">
              Причина пропуска:{" "}
              {(item.occurrence as TaskOccurrence).skip_reason}
            </p>
          )}
          {item.task &&
            (item.occurrence as TaskOccurrence).actual_minutes > 0 && (
              <p className="muted">
                Фактически: {(item.occurrence as TaskOccurrence).actual_minutes}{" "}
                мин
              </p>
            )}
          <div className="item-actions">
            <button
              className="small"
              disabled={busy || loading}
              onClick={() => void quickDone(item)}
            >
              {item.status === "done" ? "Отменить выполнение" : "Готово"}
            </button>
            <button
              className="secondary small"
              disabled={busy || loading}
              onClick={() => setStatusItem(item)}
            >
              Статус / итог
            </button>
            <button
              className="secondary small"
              disabled={busy || loading}
              onClick={() => setEditor({ kind: item.kind, item })}
            >
              Изменить / перенести
            </button>
            <button
              className="text-button small"
              disabled={busy || loading}
              onClick={() => void archiveItem(item)}
            >
              В архив
            </button>
          </div>
        </div>
      </article>
    );
  }
  const next = day.find(
    (i) =>
      i.start && i.end && Date.parse(i.end) > Date.now() && i.status === "todo",
  );
  const deadlines = data.tasks
    .filter(
      (t) =>
        !t.archived &&
        (t.due_at || t.due_date) &&
        !data.occurrences.some(
          (o) =>
            o.task_id === t.id &&
            o.status === "done" &&
            t.recurrence === "none",
        ),
    )
    .sort((a, b) => deadlineOrder(a).localeCompare(deadlineOrder(b)))
    .slice(0, 4);
  return (
    <>
      <div className="planner-intro">
        <div>
          <p className="eyebrow">
            {section === "Сегодня"
              ? "ВАШ ДЕНЬ БЕЗ ЛИШНЕГО ШУМА"
              : section.toLocaleUpperCase("ru")}
          </p>
          <h1>
            {section === "Сегодня"
              ? `${name ? name + ", " : ""}начнём с главного.`
              : section === "Календарь"
                ? "У каждого дела своё время."
                : "Освободите голову."}
          </h1>
          <p className="muted">
            {dateLabel(selected)} · {timezone}
          </p>
        </div>
        <div className="toolbar">
          <button disabled={busy || loading} onClick={() => add("task")}>
            + Задача
          </button>
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => add("event")}
          >
            + Событие
          </button>
        </div>
      </div>
      <div className="date-controls">
        <button
          className="secondary"
          aria-label="Предыдущая неделя"
          onClick={() => setSelected(addDays(selected, -7))}
        >
          ←
        </button>
        <label className="date-picker">
          Выбранный день
          <input
            aria-label="Выбранный день"
            type="date"
            value={selected}
            onChange={(e) => {
              if (e.target.value) setSelected(e.target.value);
            }}
          />
        </label>
        <button
          className="secondary"
          aria-label="Следующая неделя"
          onClick={() => setSelected(addDays(selected, 7))}
        >
          →
        </button>
        <button
          className="secondary"
          onClick={() => setSelected(localToday(timezone))}
        >
          Сегодня
        </button>
        <button
          className="text-button"
          disabled={loading || busy}
          onClick={() => void reload()}
        >
          {loading ? "Загружаем…" : "↻ Обновить"}
        </button>
        <span className="sync-status" role="status">
          {loading
            ? "Читаем облако…"
            : synced
              ? `Данные из облака · ${synced}`
              : "Нет загруженных данных"}
        </span>
      </div>
      <div className="week-strip" aria-label="Выбрать день недели">
        {dates.map((date) => (
          <button
            key={date}
            aria-pressed={selected === date}
            className={selected === date ? "selected" : ""}
            onClick={() => setSelected(date)}
          >
            <span>{dateLabel(date, { weekday: "short" })}</span>
            <strong>{date.slice(-2)}</strong>
            <small>
              {all.filter((i) => onDate(i, date, timezone)).length} дел
            </small>
          </button>
        ))}
      </div>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void reload()}
          >
            Повторить загрузку
          </button>
          <p>
            Пока загрузка не прошла, показанные ранее данные могут быть
            устаревшими.
          </p>
        </div>
      )}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {!error && !loading && section === "Сегодня" && (
        <div className="summary-grid">
          <section className="card summary">
            <p className="eyebrow">СЛЕДУЮЩЕЕ / ТЕКУЩЕЕ</p>
            <h2>{next ? next.title : "Свободное пространство"}</h2>
            <p className="muted">
              {next
                ? `${clock(next.start!, timezone)}–${clock(next.end!, timezone)}`
                : "Нет предстоящих блоков на выбранный день."}
            </p>
          </section>
          <section className="card summary">
            <p className="eyebrow">ОБЯЗАТЕЛЬНЫЕ ЗАДАЧИ</p>
            <h2>
              {progress.done} / {progress.total}
            </h2>
            <p className="muted">
              Необязательные идеи не влияют на выполнение.
            </p>
          </section>
        </div>
      )}
      {collisions.length > 0 && (
        <section className="warning" aria-label="Пересечения">
          <h2>Есть пересечения</h2>
          {collisions.map(([a, b]) => (
            <p key={a.key + b.key}>
              «{a.title}» и «{b.title}».{" "}
              {a.fixed || b.fixed
                ? "Фиксированное событие не переносится автоматически."
                : "Измените время одного из блоков."}
            </p>
          ))}
        </section>
      )}
      <div className="list-toolbar">
        <label>
          Поиск
          <input
            placeholder="Название дела"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Категория
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">Все категории</option>
            {Object.entries(categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Статус
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Все статусы</option>
            {Object.entries(statuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {section === "Календарь" && (
          <div className="segmented">
            <button
              aria-pressed={view === "day"}
              onClick={() => setView("day")}
            >
              День
            </button>
            <button
              aria-pressed={view === "week"}
              onClick={() => setView("week")}
            >
              Неделя
            </button>
          </div>
        )}
      </div>
      <section className="card agenda" aria-busy={loading}>
        <div className="section-title">
          <h2>
            {section === "Задачи"
              ? "Задачи выбранной недели"
              : section === "Календарь" && view === "week"
                ? "Ваша неделя"
                : "Лента дня"}
          </h2>
          <span className="muted">
            {loading ? "Обновляем…" : "Изменения сохраняются после ответа базы"}
          </span>
        </div>
        {section === "Задачи" ||
        (section === "Календарь" && view === "week") ? (
          dates.map((date) => {
            const items = filtered(
              all.filter(
                (i) =>
                  onDate(i, date, timezone) &&
                  (section !== "Задачи" || i.kind === "task"),
              ),
            );
            return (
              <div className="day-group" key={date}>
                <h3>{dateLabel(date)}</h3>
                {items.length ? (
                  items.map(card)
                ) : (
                  <p className="muted">
                    {loading ? "Загружаем…" : "Нет дел под выбранные фильтры."}
                  </p>
                )}
              </div>
            );
          })
        ) : filtered(day).length ? (
          filtered(day).map(card)
        ) : (
          <div className="empty-state">
            <h3>
              {loading ? "Загружаем день…" : "Можно начать с одного дела"}
            </h3>
            <p className="muted">
              {error
                ? "Сначала восстановите подключение к базе."
                : "Добавьте задачу без времени или запланируйте событие."}
            </p>
            <button
              disabled={loading || busy || !!error}
              onClick={() => add("task")}
            >
              Добавить задачу
            </button>
          </div>
        )}
      </section>
      {section === "Сегодня" && (
        <section className="card deadlines">
          <h2>Ближайшие дедлайны</h2>
          {deadlines.length ? (
            deadlines.map((t) => (
              <div key={t.id}>
                <strong>{t.title}</strong>
                <p className="muted">
                  {t.due_certainty === "tentative" ? "Предварительно · " : ""}
                  {deadlineLabel(t, timezone)}
                </p>
                <button
                  className="secondary small"
                  onClick={() => setSelected(t.start_date)}
                >
                  К запланированному дню
                </button>
              </div>
            ))
          ) : (
            <p className="muted">
              Пока нет задач с указанным сроком. Неизвестные сроки не
              превращаются в придуманные дедлайны.
            </p>
          )}
        </section>
      )}
      <button
        className="text-button archive-toggle"
        onClick={() => setArchive(!archive)}
      >
        {archive ? "Скрыть архив" : "Показать архив"}
      </button>
      {archive && (
        <section className="card">
          <h2>Архив</h2>
          {[
            ...data.tasks
              .filter((t) => t.archived)
              .map((t) => ({ ...t, kind: "task" as const })),
            ...data.events
              .filter((e) => e.archived)
              .map((e) => ({ ...e, kind: "event" as const })),
          ].map((item) => (
            <div className="archive-row" key={item.id}>
              <span>{item.title}</span>
              <button
                disabled={busy || loading}
                className="secondary small"
                onClick={() =>
                  void mutate(async () => {
                    if (!supabase) return;
                    const { error } = await supabase.rpc(
                      "archive_planner_item",
                      {
                        p_kind: item.kind,
                        p_id: item.id,
                        p_version: item.version,
                        p_archived: false,
                        p_confirm_fixed: true,
                      },
                    );
                    if (error) throw error;
                  }, "Запись восстановлена из архива.")
                }
              >
                Восстановить
              </button>
            </div>
          ))}
          {!data.tasks.some((t) => t.archived) &&
            !data.events.some((e) => e.archived) && (
              <p className="muted">Архив пуст.</p>
            )}
        </section>
      )}
      {editor && (
        <ItemEditor
          kind={editor.kind}
          original={editor.item}
          selected={selected}
          timezone={
            editor.item?.task?.timezone ||
            editor.item?.event?.timezone ||
            timezone
          }
          items={all}
          onClose={() => setEditor(null)}
          onSaved={async (date, start) => {
            setEditor(null);
            setSelected(
              start ? localDateTime(start, timezone).slice(0, 10) : date,
            );
            setMessage("Изменения сохранены в облаке.");
            await reload();
          }}
        />
      )}
      {statusItem && (
        <StatusEditor
          item={statusItem}
          onClose={() => setStatusItem(null)}
          onSaved={async () => {
            setStatusItem(null);
            setMessage("Статус сохранён в облаке.");
            await reload();
          }}
        />
      )}
    </>
  );
}
function Dialog({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="editor-dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="secondary"
          type="button"
          aria-label="Закрыть форму"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ItemEditor({
  kind,
  original,
  selected,
  timezone,
  items,
  onClose,
  onSaved,
}: {
  kind: "task" | "event";
  original: DayItem | null;
  selected: string;
  timezone: string;
  items: DayItem[];
  onClose: () => void;
  onSaved: (date: string, start: string | null) => Promise<void>;
}) {
  const [form, setForm] = useState<ItemForm>(() => {
    const f = defaultItemForm(selected);
    if (!original) {
      if (kind === "event") {
        f.time = "09:00";
        f.end_time = "10:00";
      }
      return f;
    }
    const t = original.task,
      e = original.event;
    return {
      ...f,
      title: original.title,
      description: original.description,
      category: original.category,
      date: original.date,
      time: original.start ? clock(original.start, timezone) : "",
      end_date: original.end
        ? localDateTime(original.end, timezone).slice(0, 10)
        : original.date,
      end_time: original.end ? clock(original.end, timezone) : "",
      estimated_minutes: t?.estimated_minutes || 30,
      priority: t?.priority || 2,
      due_local: t?.due_at
        ? localDateTime(t.due_at, timezone)
        : t?.due_date || "",
      due_mode: t?.due_at ? "datetime" : "date",
      due_certainty: t?.due_certainty || "unknown",
      optional: t?.optional || false,
      fixed: e?.fixed ?? true,
      recurrence: t?.recurrence || e?.recurrence || "none",
      repeat_until: t?.repeat_until || e?.repeat_until || "",
    };
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [allowOverlap, setAllowOverlap] = useState(false);
  function field<K extends keyof ItemForm>(key: K, value: ItemForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setAllowOverlap(false);
  }
  const [targetItems, setTargetItems] = useState<DayItem[]>(items);
  const [checkingTarget, setCheckingTarget] = useState(false);
  const [targetError, setTargetError] = useState("");
  useEffect(() => {
    let active = true;
    let week: string[];
    try {
      week = weekDates(form.date);
    } catch {
      setTargetItems(items);
      return;
    }
    if (week[0] === weekDates(selected)[0]) {
      setTargetItems(items);
      setCheckingTarget(false);
      setTargetError("");
      return;
    }
    setCheckingTarget(true);
    setTargetError("");
    setAllowOverlap(false);
    loadPlanner(week[0], week[6])
      .then((data) => {
        if (active)
          setTargetItems(
            dayItems(
              data.tasks,
              data.occurrences,
              data.events,
              data.eventOccurrences,
            ),
          );
      })
      .catch((e) => {
        if (active) setTargetError(friendlyError(e));
      })
      .finally(() => {
        if (active) setCheckingTarget(false);
      });
    return () => {
      active = false;
    };
  }, [form.date, selected, items]);
  const overlaps = useMemo(() => {
    try {
      const s = validateSchedule(form, kind, timezone);
      return s.start && s.end
        ? targetItems.filter(
            (i) =>
              i.key !== original?.key &&
              i.start &&
              i.end &&
              i.status !== "skipped" &&
              Date.parse(s.start!) < Date.parse(i.end) &&
              Date.parse(i.start) < Date.parse(s.end!),
          )
        : [];
    } catch {
      return [];
    }
  }, [form, kind, timezone, targetItems, original]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = itemFormSchema.safeParse(
      original ? { ...form, recurrence: "none", repeat_until: "" } : form,
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (checkingTarget || targetError) {
      setError(targetError || "Дождитесь проверки выбранной недели.");
      return;
    }
    if (overlaps.length && !allowOverlap) {
      setError("Подтвердите сохранение пересечения или измените время.");
      return;
    }
    if (original?.fixed && !confirmed) {
      setError("Подтвердите изменение закреплённого события.");
      return;
    }
    setBusy(true);
    try {
      await saveItem(kind, parsed.data, timezone, original, confirmed);
      await onSaved(
        form.date,
        validateSchedule(parsed.data, kind, timezone).start,
      );
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`${original ? "Изменить" : "Добавить"} ${kind === "task" ? "задачу" : "событие"}`}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <p className="muted">
            Время записи: {timezone}.{" "}
            {original &&
            (original.task?.recurrence || original.event?.recurrence) !== "none"
              ? "Общие свойства меняются для всей серии; дата, время и статус — только для этого повторения. Длительность шаблона применяется к будущим ещё не созданным повторам."
              : ""}
          </p>
          <label>
            Название
            <input
              autoFocus
              value={form.title}
              required
              maxLength={200}
              onChange={(e) => field("title", e.target.value)}
            />
          </label>
          <label>
            Описание
            <textarea
              value={form.description}
              maxLength={3000}
              rows={3}
              onChange={(e) => field("description", e.target.value)}
            />
          </label>
          <div className="row">
            <label>
              Категория
              <select
                value={form.category}
                onChange={(e) => field("category", e.target.value as Category)}
              >
                {Object.entries(categories).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {kind === "task" && (
              <label>
                Приоритет
                <select
                  value={form.priority}
                  onChange={(e) => field("priority", Number(e.target.value))}
                >
                  <option value={1}>Высокий</option>
                  <option value={2}>Обычный</option>
                  <option value={3}>Низкий</option>
                </select>
              </label>
            )}
          </div>
          <div className="row">
            <label>
              Дата
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => {
                  field("date", e.target.value);
                  if (kind === "event" && form.end_date === form.date)
                    field("end_date", e.target.value);
                }}
              />
            </label>
            <label>
              {kind === "task" ? "Начало (необязательно)" : "Начало"}
              <input
                type="time"
                required={kind === "event"}
                value={form.time}
                onChange={(e) => field("time", e.target.value)}
              />
            </label>
          </div>
          {kind === "event" ? (
            <>
              <div className="row">
                <label>
                  Дата окончания
                  <input
                    type="date"
                    required
                    value={form.end_date}
                    onChange={(e) => field("end_date", e.target.value)}
                  />
                </label>
                <label>
                  Окончание
                  <input
                    type="time"
                    required
                    value={form.end_time}
                    onChange={(e) => field("end_time", e.target.value)}
                  />
                </label>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.fixed}
                  onChange={(e) => field("fixed", e.target.checked)}
                />
                Закреплённое событие: перенос требует подтверждения
              </label>
            </>
          ) : (
            <>
              <label>
                Плановая длительность, мин
                <input
                  type="number"
                  min={5}
                  max={720}
                  step={5}
                  value={form.estimated_minutes}
                  required
                  onChange={(e) =>
                    field("estimated_minutes", Number(e.target.value))
                  }
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.optional}
                  onChange={(e) => field("optional", e.target.checked)}
                />
                Необязательная задача — без влияния на обязательный прогресс
              </label>
              <label>
                Точность срока
                <select
                  aria-label="Точность срока"
                  value={form.due_mode}
                  onChange={(e) => {
                    field("due_mode", e.target.value as ItemForm["due_mode"]);
                    field("due_local", "");
                    field("due_certainty", "unknown");
                  }}
                >
                  <option value="date">Только день</option>
                  <option value="datetime">День и точное время</option>
                </select>
              </label>
              <label>
                Срок (необязательно)
                <input
                  type={form.due_mode === "date" ? "date" : "datetime-local"}
                  value={form.due_local}
                  onChange={(e) => {
                    field("due_local", e.target.value);
                    if (!e.target.value) field("due_certainty", "unknown");
                    else if (form.due_certainty === "unknown")
                      field("due_certainty", "confirmed");
                  }}
                />
              </label>
              <label>
                Определённость срока
                <select
                  value={form.due_certainty}
                  onChange={(e) =>
                    field(
                      "due_certainty",
                      e.target.value as ItemForm["due_certainty"],
                    )
                  }
                >
                  <option value="unknown">Срок неизвестен</option>
                  <option value="confirmed">Подтверждён</option>
                  <option value="tentative">Предварительный</option>
                </select>
              </label>
            </>
          )}
          {!original && (
            <>
              <label>
                Повторять
                <select
                  value={form.recurrence}
                  onChange={(e) =>
                    field(
                      "recurrence",
                      e.target.value as ItemForm["recurrence"],
                    )
                  }
                >
                  <option value="none">Не повторять</option>
                  <option value="daily">Ежедневно</option>
                  <option value="weekly">Еженедельно, в этот день</option>
                </select>
              </label>
              {form.recurrence !== "none" && (
                <label>
                  Повторять до (включительно, максимум год)
                  <input
                    type="date"
                    min={form.date}
                    max={form.date ? addDays(form.date, 366) : undefined}
                    required
                    value={form.repeat_until}
                    onChange={(e) => field("repeat_until", e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          {checkingTarget && (
            <p role="status">Проверяем дела на выбранной неделе…</p>
          )}
          {targetError && (
            <p role="alert" className="error">
              {targetError}
            </p>
          )}
          {original?.fixed && (
            <label className="check-label warning">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Подтверждаю изменение закреплённого события
            </label>
          )}
          {overlaps.length > 0 && (
            <div className="warning">
              <p>Пересекается с: {overlaps.map((i) => i.title).join(", ")}.</p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={allowOverlap}
                  onChange={(e) => setAllowOverlap(e.target.checked)}
                />
                Сохранить пересечение осознанно
              </label>
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="submit" disabled={checkingTarget || !!targetError}>
              {busy ? "Сохраняем…" : "Сохранить в облаке"}
            </button>
            <button className="secondary" type="button" onClick={onClose}>
              Отмена
            </button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
function StatusEditor({
  item,
  onClose,
  onSaved,
}: {
  item: DayItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status>(item.status),
    [minutes, setMinutes] = useState(
      item.task ? (item.occurrence as TaskOccurrence).actual_minutes : 0,
    ),
    [note, setNote] = useState(item.occurrence.completion_note),
    [reason, setReason] = useState(
      item.task ? (item.occurrence as TaskOccurrence).skip_reason : "",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("set_planner_status", {
        p_kind: item.kind,
        p_id: item.occurrence.id,
        p_version: item.occurrence.version,
        p_status: status,
        p_actual_minutes: minutes,
        p_note: note,
        p_skip_reason: reason,
      });
      if (error) throw error;
      await onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Итог: ${item.title}`} busy={busy} onClose={onClose}>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Статус
            <select
              aria-label="Статус"
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              {Object.entries(statuses).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {item.task && (
            <label>
              Фактически потрачено, мин
              <input
                type="number"
                required
                min={0}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
          )}
          <label>
            Результат / заметка
            <textarea
              maxLength={3000}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {item.task && status === "skipped" && (
            <label>
              Причина пропуска
              <input
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button>{busy ? "Сохраняем…" : "Сохранить итог"}</button>
            <button type="button" className="secondary" onClick={onClose}>
              Отмена
            </button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
