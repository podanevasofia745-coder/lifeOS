"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import Planner from "../components/planner";
import { defaultProfile, profileSchema, type Profile } from "../lib/profile";
const sections = [
  "Сегодня",
  "Календарь",
  "Задачи",
  "Учёба",
  "Языки",
  "Спорт и здоровье",
  "Развитие",
  "Аналитика",
  "Настройки",
];
export default function Home() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [register, setRegister] = useState(false),
    [section, setSection] = useState("Сегодня");
  const [moreOpen, setMoreOpen] = useState(false);
  const [savedTimezone, setSavedTimezone] = useState(defaultProfile.timezone);
  const [profile, setProfile] = useState<Profile>(defaultProfile),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setError(error.message);
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (_event !== "TOKEN_REFRESHED") {
        setError("");
        setMessage("");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session || !supabase) return;
    let active = true;
    setLoading(true);
    supabase
      .from("profiles")
      .select("*")
      .eq("user_id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error)
          setError(
            `Не удалось загрузить профиль: ${error.message}. Проверьте миграцию и подключение.`,
          );
        else {
          setSavedTimezone(data.timezone);
          setProfile({
            ...data,
            preferred_wake: data.preferred_wake.slice(0, 5),
            preferred_bedtime: data.preferred_bedtime.slice(0, 5),
          });
          setLoaded(true);
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.user.id]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        profile.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : profile.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [profile.theme]);
  async function auth(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = register
        ? await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin + "/" },
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (register && !result.data.session)
        setMessage("Проверьте почту и подтвердите регистрацию, затем войдите.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !session || !loaded) return;
    setError("");
    setMessage("");
    const parsed = profileSchema.safeParse(profile);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .update(parsed.data)
        .eq("user_id", session.user.id)
        .eq("version", profile.version)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        setError(
          "Профиль изменён на другом устройстве. Ваши правки не перезаписали облако. Перезагрузите страницу, чтобы получить актуальную версию.",
        );
        return;
      }
      setSavedTimezone(data.timezone);
      setProfile({
        ...data,
        preferred_wake: data.preferred_wake.slice(0, 5),
        preferred_bedtime: data.preferred_bedtime.slice(0, 5),
      });
      setMessage("Профиль сохранён в облаке.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Сохранение не удалось");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    if (error) setError(error.message);
    else {
      setProfile(defaultProfile);
      setLoaded(false);
    }
    setBusy(false);
  }
  const status = (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
    </>
  );
  if (!supabase)
    return (
      <main className="setup">
        <a className="logo" href="/">
          life<span>OS</span>
        </a>
        <p className="eyebrow">ПЕРВЫЙ ШАГ</p>
        <h1>
          Подключим ваш
          <br />
          личный мир.
        </h1>
        <p>
          Новая версия использует личный аккаунт и облачную базу. Supabase ещё
          не подключён: вход и облачное сохранение недоступны.
        </p>
        <section className="card">
          <h2>Настройка Supabase</h2>
          <ol>
            <li>Создайте проект в Supabase.</li>
            <li>
              В SQL Editor выполните миграцию из{" "}
              <code>supabase/migrations/202610260001_profiles.sql</code>.
            </li>
            <li>
              В Netlify → Environment variables добавьте{" "}
              <code>NEXT_PUBLIC_SUPABASE_URL</code> и{" "}
              <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> из настроек
              проекта Supabase.
            </li>
            <li>
              В Supabase → Authentication → URL Configuration добавьте адрес
              сайта и повторите деплой.
            </li>
          </ol>
          <p>
            Используйте только публичный publishable/anon ключ. Secret и service
            role ключи здесь не нужны.
          </p>
        </section>
        <p className="muted">
          Текущие задачи старой версии остаются в localStorage браузера.
          Автоматического переноса пока нет.
        </p>
      </main>
    );
  if (loading)
    return (
      <main className="setup" role="status">
        <h1>lifeOS</h1>
        <p>Загружаем ваш профиль…</p>
      </main>
    );
  if (!session)
    return (
      <main className="auth">
        <section>
          <a className="logo" href="/">
            life<span>OS</span>
          </a>
          <p className="eyebrow">МЕСТО ДЛЯ ВАЖНОГО</p>
          <h1>
            Ваш день.
            <br />
            Ваш ритм.
          </h1>
          <p>Учёба, восстановление и планы — с заботой о себе.</p>
        </section>
        <form className="card" onSubmit={auth}>
          <h2>{register ? "Создать аккаунт" : "С возвращением"}</h2>
          <p className="muted">Личный профиль с сохранением в облаке.</p>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {status}
          <button disabled={busy}>
            {busy ? "Подождите…" : register ? "Зарегистрироваться" : "Войти"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setRegister(!register);
              setError("");
              setMessage("");
            }}
          >
            {register ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Создать"}
          </button>
        </form>
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <a className="logo" href="/">
          life<span>OS</span>
        </a>
        <p className="eyebrow">ВАШ ЛИЧНЫЙ РИТМ</p>
        <nav aria-label="Основные разделы">
          {sections.map((s) => (
            <button
              key={s}
              aria-current={section === s ? "page" : undefined}
              onClick={() => {
                setSection(s);
                setMessage("");
              }}
            >
              {s}
            </button>
          ))}
        </nav>
        <button className="secondary" disabled={busy} onClick={logout}>
          Выйти
        </button>
      </aside>
      <main className="content">
        <header>
          <span>ЛИЧНОЕ ПРОСТРАНСТВО</span>
          <span>
            {loaded ? "Профиль загружен из облака" : "Профиль недоступен"}
          </span>
        </header>
        {status}
        {section === "Настройки" ? (
          <>
            <p className="eyebrow">ПРОФИЛЬ И ПРЕДПОЧТЕНИЯ</p>
            <h1>По вашим правилам.</h1>
            <form className="card profile" onSubmit={save}>
              <h2>Личные настройки</h2>
              <label>
                Как вас называть
                <input
                  value={profile.display_name}
                  maxLength={80}
                  required
                  onChange={(e) =>
                    setProfile({ ...profile, display_name: e.target.value })
                  }
                />
              </label>
              <label>
                Часовой пояс
                <input
                  value={profile.timezone}
                  required
                  onChange={(e) =>
                    setProfile({ ...profile, timezone: e.target.value })
                  }
                />
                <small>Например, Europe/Moscow или Europe/Berlin</small>
              </label>
              <label>
                Оформление
                <select
                  value={profile.theme}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      theme: e.target.value as Profile["theme"],
                    })
                  }
                >
                  <option value="system">Как на устройстве</option>
                  <option value="light">Светлое</option>
                  <option value="dark">Тёмное</option>
                </select>
              </label>
              <div className="row">
                <label>
                  Подъём
                  <input
                    type="time"
                    required
                    value={profile.preferred_wake}
                    onChange={(e) =>
                      setProfile({ ...profile, preferred_wake: e.target.value })
                    }
                  />
                </label>
                <label>
                  Отход ко сну
                  <input
                    type="time"
                    required
                    value={profile.preferred_bedtime}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        preferred_bedtime: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <label>
                Цель сна, часов
                <input
                  type="number"
                  min={4}
                  max={12}
                  step={0.5}
                  required
                  value={profile.target_sleep_minutes / 60}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      target_sleep_minutes: Number(e.target.value) * 60,
                    })
                  }
                />
              </label>
              <p className="muted">
                Это предпочтения для будущего планирования, а не запись
                фактического сна.
              </p>
              <button disabled={busy || !loaded}>
                {busy ? "Сохраняем…" : "Сохранить профиль"}
              </button>
            </form>
          </>
        ) : ["Сегодня", "Календарь", "Задачи"].includes(section) ? (
          loaded ? (
            <Planner
              key={session.user.id}
              userId={session.user.id}
              timezone={savedTimezone}
              name={profile.display_name}
              section={section}
            />
          ) : (
            <section className="card">
              <h2>Профиль пока не загрузился</h2>
              <p>Для планирования нужен часовой пояс из вашего профиля.</p>
              <button onClick={() => location.reload()}>
                Повторить загрузку
              </button>
            </section>
          )
        ) : (
          <>
            <p className="eyebrow">{section.toLocaleUpperCase("ru")}</p>
            <h1>
              {section === "Сегодня"
                ? `Здравствуйте${profile.display_name ? ", " + profile.display_name : ""}.`
                : section}
            </h1>
            <section className="card">
              <h2>
                {section === "Сегодня"
                  ? "Начнём с вашего ритма"
                  : "Раздел появится на следующем этапе"}
              </h2>
              <p>
                {section === "Сегодня"
                  ? "Аккаунт и профиль — фундамент личного планировщика. Настройте часовой пояс, сон и оформление."
                  : "Здесь пока нет реализованных функций. Мы не показываем вымышленные задачи, события или статистику."}
              </p>
              <button onClick={() => setSection("Настройки")}>
                Открыть настройки
              </button>
            </section>
            <p className="muted">
              Языки, учебные и другие модули появятся на следующих этапах ТЗ.
              Задачи, события и план дня доступны в первых трёх разделах.
            </p>
          </>
        )}
      </main>
      {moreOpen && (
        <nav className="mobile-more" aria-label="Другие разделы">
          {sections
            .filter(
              (s) =>
                !["Сегодня", "Календарь", "Задачи", "Настройки"].includes(s),
            )
            .map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSection(s);
                  setMoreOpen(false);
                }}
              >
                {s}
              </button>
            ))}
        </nav>
      )}
      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {["Сегодня", "Календарь", "Задачи", "Настройки"].map((s) => (
          <button
            key={s}
            aria-current={section === s ? "page" : undefined}
            onClick={() => {
              setSection(s);
              setMoreOpen(false);
              setMessage("");
            }}
          >
            {s}
          </button>
        ))}
        <button aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
          Ещё
        </button>
      </nav>
    </div>
  );
}
