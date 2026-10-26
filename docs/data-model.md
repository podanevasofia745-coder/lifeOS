# Данные — этап 1

Миграция: supabase/migrations/202610260001_profiles.sql (транзакция, повторный запуск поддержан).

profiles: user_id UUID PK/FK auth.users ON DELETE CASCADE, display_name (0–80 символов; сохранение формы требует непустое имя), timezone (IANA, проверка PostgreSQL при update), locale, theme enum через CHECK, preferred_wake/bedtime time, target_sleep_minutes 240–720, version, created_at, updated_at.

Auth-триггер создаёт профиль; миграция также создаёт профили существующим пользователям. SECURITY DEFINER фиксирует search_path, не читает пользовательские метаданные. Клиенту не выданы INSERT/DELETE. RLS разрешает authenticated SELECT/UPDATE только с auth.uid()=user_id. UPDATE проверяет и новое значение user_id. BEFORE UPDATE защищает идентичность, увеличивает версию и время. Клиент сравнивает предыдущую версию в WHERE.

Остальные сущности из ТЗ проектируются на следующих этапах; фиктивных таблиц и персонального seed пока нет. Будущие tasks/calendar/habits требуют таких же RLS, версий, индексов user/date, проверок end>start и явной certainty. Настройка двух пользователей и выполнение RLS-теста обязательны до приёмки облачной инфраструктуры.
