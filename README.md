# lifeOS — задачи, календарь и личный профиль

Русскоязычный персональный планировщик по поэтапному ТЗ. Реализованы аккаунт, облачный профиль, темы, задачи, события и дневной/недельный календарь. Автоматический планировщик и языковые модули — следующие этапы. Старая версия сохранена в `legacy/`; её localStorage не удаляется.

## Локально

Node.js 20.19+ или 22+, npm, Supabase проект.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

В `.env.local` укажите реальный URL Supabase и публичный publishable/anon ключ. Не используйте secret/service_role. Без конфигурации сайт покажет инструкцию подключения, а не рабочий аккаунт.

## Supabase

1. Создайте проект на supabase.com.
2. SQL Editor → выполните `supabase/migrations/202610260001_profiles.sql`.
3. Authentication → Providers → Email: включите вход и подтверждение email, установите минимум 8 символов пароля.
4. Authentication → URL Configuration: Site URL `https://lifeos-karusel.netlify.app`, разрешённые redirect URLs для своего сайта и локальной разработки.
5. Project Settings / API: скопируйте URL и публичный publishable key в переменные окружения.
6. Зарегистрируйтесь, подтвердите почту и войдите. Откройте Настройки → сохраните профиль → обновите страницу.

## Netlify (новая версия Next.js)

Base directory: пусто. Build command: `npm run build`. Publish directory: `out`. Netlify публикует папку out; настройки зафиксированы в netlify.toml. Добавьте `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (либо legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) в Environment variables. Выполните новый deploy после изменения переменных. Ключи service_role/secret не добавлять.

## Проверки

```sh
npm run typecheck
npm test
npm run build
npm start
```

`npm start` запускает сервер статического экспорта на порту 3000 после build. `npm run dev` — разработка. HTTP smoke: запрос `/` должен вернуть экран настройки при отсутствии окружения; это не проверка auth.

Для интеграционного RLS-теста создайте два подтверждённых тестовых аккаунта в тестовом проекте. Задайте URL, публичный ключ и `TEST_USER_A_EMAIL`, `TEST_USER_A_PASSWORD`, `TEST_USER_B_EMAIL`, `TEST_USER_B_PASSWORD` безопасно в окружении, затем `npm run test:rls`. Скрипт не выводит значения, не использует service_role, проверяет изоляцию в обе стороны, изменение собственного профиля и конфликт версии. Меняется только версия собственного тестового профиля (имя сохраняется).

Облачные проверки и E2E требуют настоящего Supabase; отсутствие ключей — блокер приёмки этапа 1. Не считать страницу настройки доказательством облачного сохранения.

Подробнее: docs/architecture.md, docs/data-model.md, docs/decisions.md, docs/acceptance.md.

## Этап 2 — задачи и календарь

Выполните дополнительную миграцию `supabase/migrations/202610260002_planner.sql` в SQL Editor. Профили сохраняются. Настройки Netlify/публичные переменные не меняются. До миграции в новых разделах будет понятная ошибка подключения схемы.

Работают задачи и события, день/неделя/список, фильтры, сроки с certainty, ежедневные/еженедельные повторения, перенос, частичное выполнение, факт времени, архив/восстановление, конфликты и защита закреплённых событий. Двухустройственные изменения обнаруживаются по версиям; данные обновляются вручную или при возвращении к вкладке.

```sh
npm run format:check
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Unit/integration запускают настоящий локальный PostgreSQL (PGlite) без ключей. E2E требует Chromium (`CHROMIUM_PATH=/путь/к/chromium` или браузер Playwright) и свободные порты 3130/3131. Локальный стенд подменяет только авторизацию, а операции проверяет на настоящей SQL-схеме; это не проверка настоящего Supabase Auth. Все тестовые данные вымышлены, стенд доступен только через loopback. История старого планировщика в localStorage пока не импортируется.

Полный отчёт этапа: `docs/stage-2.md`.
