begin;
create table if not exists public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check (char_length(display_name)<=80),
 timezone text not null default 'Europe/Moscow',
 locale text not null default 'ru',
 theme text not null default 'system' check(theme in ('light','dark','system')),
 preferred_wake time not null default '07:00',
 preferred_bedtime time not null default '23:00',
 target_sleep_minutes integer not null default 480 check(target_sleep_minutes between 240 and 720),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
revoke all on public.profiles from anon;
grant select, update on public.profiles to authenticated;
drop policy if exists own_profile_read on public.profiles;
create policy own_profile_read on public.profiles for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists own_profile_update on public.profiles;
create policy own_profile_update on public.profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create or replace function public.validate_profile_update() returns trigger language plpgsql set search_path='' as $$
begin
 if new.user_id<>old.user_id or new.created_at<>old.created_at then raise exception 'Immutable profile identity'; end if;
 if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Invalid timezone'; end if;
 new.version:=old.version+1;
 new.updated_at:=now();
 return new;
end;$$;
drop trigger if exists profile_updated on public.profiles;
create trigger profile_updated before update on public.profiles for each row execute function public.validate_profile_update();
create or replace function public.create_user_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(user_id) values(new.id) on conflict (user_id) do nothing;
 return new;
end;$$;
revoke all on function public.create_user_profile() from public,anon,authenticated;
drop trigger if exists lifeos_user_created on auth.users;
create trigger lifeos_user_created after insert on auth.users for each row execute function public.create_user_profile();
-- Backfill existing accounts; no user-provided personal seed is imported.
insert into public.profiles(user_id) select id from auth.users on conflict (user_id) do nothing;
commit;
