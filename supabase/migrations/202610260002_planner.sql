begin;
create table if not exists public.tasks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(trim(title)) between 1 and 200), description text not null default '' check(char_length(description)<=3000),
 category text not null default 'personal' check(category in ('study','work','personal','health','household','language','leisure')),
 priority integer not null default 2 check(priority between 1 and 3),
 due_at timestamptz, due_date date, due_certainty text not null default 'unknown' check(due_certainty in ('confirmed','tentative','unknown')),
 estimated_minutes integer not null default 30 check(estimated_minutes between 5 and 720), optional boolean not null default false,
 start_date date not null, preferred_time time, timezone text not null default 'Europe/Moscow',
 recurrence text not null default 'none' check(recurrence in ('none','daily','weekly')), repeat_until date,
 archived boolean not null default false, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id),
 check((due_at is null and due_date is null)=(due_certainty='unknown')),
 check(due_at is null or due_date is null),
 check((recurrence='none' and repeat_until is null) or (recurrence<>'none' and repeat_until is not null and repeat_until between start_date and start_date+366))
);
create table if not exists public.task_occurrences (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid not null, source_date date not null, local_date date not null,
 planned_start timestamptz, planned_end timestamptz, actual_minutes integer not null default 0 check(actual_minutes between 0 and 1440),
 status text not null default 'todo' check(status in ('todo','partial','done','skipped')),
 completion_note text not null default '' check(char_length(completion_note)<=3000), skip_reason text not null default '' check(char_length(skip_reason)<=500),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(task_id,user_id) references public.tasks(id,user_id) on delete cascade, unique(task_id,source_date),
 check((planned_start is null and planned_end is null) or (planned_start is not null and planned_end is not null and planned_end>planned_start and planned_end<=planned_start+interval '24 hours'))
);
create table if not exists public.calendar_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(trim(title)) between 1 and 200), description text not null default '' check(char_length(description)<=3000),
 category text not null default 'personal' check(category in ('study','work','personal','health','household','language','leisure')),
 fixed boolean not null default true, start_at timestamptz not null, end_at timestamptz not null,
 timezone text not null default 'Europe/Moscow', recurrence text not null default 'none' check(recurrence in ('none','daily','weekly')), repeat_until date,
 archived boolean not null default false, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id),
 check(end_at>start_at and end_at<=start_at+interval '24 hours'),
 check((recurrence='none' and repeat_until is null) or (recurrence<>'none' and repeat_until is not null and repeat_until >= (start_at at time zone timezone)::date and repeat_until <= (start_at at time zone timezone)::date+366))
);
create table if not exists public.event_occurrences (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 event_id uuid not null, source_date date not null, local_date date not null,
 start_at timestamptz not null, end_at timestamptz not null,
 status text not null default 'todo' check(status in ('todo','partial','done','skipped')),
 completion_note text not null default '' check(char_length(completion_note)<=3000),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(event_id,user_id) references public.calendar_events(id,user_id) on delete cascade, unique(event_id,source_date),
 check(end_at>start_at and end_at<=start_at+interval '24 hours')
);
create index if not exists tasks_user_due on public.tasks(user_id,due_at) where not archived;
create index if not exists tasks_user_due_date on public.tasks(user_id,due_date) where not archived;
create index if not exists tasks_user_start on public.tasks(user_id,start_date) where not archived;
create index if not exists occurrences_user_date on public.task_occurrences(user_id,local_date,status);
create index if not exists events_user_start on public.calendar_events(user_id,start_at) where not archived;
create index if not exists event_occurrences_user_date on public.event_occurrences(user_id,local_date);
-- Deny direct API writes. Every mutation below checks ownership and expected version.
do $$declare t text;begin
 foreach t in array array['tasks','task_occurrences','calendar_events','event_occurrences'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('drop policy if exists own_rows on public.%I',t);
 execute format('create policy own_rows on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
 end loop;
end;$$;
create or replace function public.lifeos_touch() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.user_id<>old.user_id or new.created_at<>old.created_at then raise exception 'Immutable identity'; end if;
 new.version:=old.version+1;new.updated_at:=now();return new;
end;$$;
do $$declare t text;begin
 foreach t in array array['tasks','task_occurrences','calendar_events','event_occurrences'] loop
 execute format('drop trigger if exists lifeos_touch on public.%I',t);
 execute format('create trigger lifeos_touch before update on public.%I for each row execute function public.lifeos_touch()',t);
 end loop;
end;$$;
-- Recurrences use local wall time. Reject missing or ambiguous DST times explicitly.
create or replace function public.lifeos_local_instant(d date,t time,z text) returns timestamptz language plpgsql stable set search_path='' as $$
declare local_value timestamp:=d+t; candidate timestamptz; delta interval;
begin
 if not exists(select 1 from pg_timezone_names where name=z) then raise exception 'Invalid timezone';end if;
 candidate:=local_value at time zone z;
 if (candidate at time zone z)<>local_value then raise exception 'Nonexistent local time (DST). Edit recurrence time.';end if;
 delta:=((candidate+interval '1 day') at time zone z)-((candidate+interval '1 day') at time zone 'UTC')-(((candidate-interval '1 day') at time zone z)-((candidate-interval '1 day') at time zone 'UTC'));
 if delta<>interval '0' and (((candidate+delta) at time zone z)=local_value or ((candidate-delta) at time zone z)=local_value) then raise exception 'Ambiguous local time (DST). Edit recurrence time.';end if;
 return candidate;
end;$$;
create or replace function public.ensure_planner_occurrences(p_from date,p_to date) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); t public.tasks; e public.calendar_events; d date; base date; stamp timestamptz;
begin
 if uid is null then raise exception 'Authentication required';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>30 then raise exception 'Range must be 1–31 days';end if;
 for t in select * from public.tasks where user_id=uid and not archived and start_date<=p_to and (recurrence='none' or repeat_until>=p_from) loop
 for d in select generate_series(greatest(p_from,t.start_date)::timestamp,p_to::timestamp,interval '1 day')::date loop
 if (t.recurrence='none' and d=t.start_date) or (t.recurrence='daily' and d<=t.repeat_until) or (t.recurrence='weekly' and d<=t.repeat_until and (d-t.start_date)%7=0) then
 -- Do not regenerate moved/skipped/completed instances: source_date remains unchanged.
 if not exists(select 1 from public.task_occurrences where task_id=t.id and source_date=d) then
 stamp:=case when t.preferred_time is null then null else public.lifeos_local_instant(d,t.preferred_time,t.timezone) end;
 insert into public.task_occurrences(user_id,task_id,source_date,local_date,planned_start,planned_end) values(uid,t.id,d,d,stamp,stamp+make_interval(mins=>t.estimated_minutes)) on conflict(task_id,source_date) do nothing;
 end if;end if;
 end loop;end loop;
 for e in select * from public.calendar_events where user_id=uid and not archived and (start_at at time zone timezone)::date<=p_to loop
 base:=(e.start_at at time zone e.timezone)::date;
 for d in select generate_series(greatest(p_from,base)::timestamp,p_to::timestamp,interval '1 day')::date loop
 if (e.recurrence='none' and d=base) or (e.recurrence='daily' and d<=e.repeat_until) or (e.recurrence='weekly' and d<=e.repeat_until and (d-base)%7=0) then
 if not exists(select 1 from public.event_occurrences where event_id=e.id and source_date=d) then
 stamp:=public.lifeos_local_instant(d,(e.start_at at time zone e.timezone)::time,e.timezone);
 insert into public.event_occurrences(user_id,event_id,source_date,local_date,start_at,end_at) values(uid,e.id,d,d,stamp,stamp+(e.end_at-e.start_at)) on conflict(event_id,source_date) do nothing;
 end if;end if;
 end loop;end loop;
end;$$;
create or replace function public.save_planner_task(p_task jsonb,p_occurrence jsonb,p_task_version integer default null,p_occurrence_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); t public.tasks; o public.task_occurrences; d date:=(p_occurrence->>'local_date')::date; s timestamptz:=(p_occurrence->>'planned_start')::timestamptz; f timestamptz:=(p_occurrence->>'planned_end')::timestamptz;
begin
 if uid is null then raise exception 'Authentication required';end if;
 if d is null then raise exception 'Date required';end if;
 if p_task->>'id' is null then
 if not exists(select 1 from pg_timezone_names where name=p_task->>'timezone') then raise exception 'Invalid timezone';end if;
 insert into public.tasks(user_id,title,description,category,priority,due_at,due_date,due_certainty,estimated_minutes,optional,start_date,preferred_time,timezone,recurrence,repeat_until)
 values(uid,p_task->>'title',coalesce(p_task->>'description',''),p_task->>'category',(p_task->>'priority')::int,(p_task->>'due_at')::timestamptz,(p_task->>'due_date')::date,p_task->>'due_certainty',(p_task->>'estimated_minutes')::int,(p_task->>'optional')::boolean,d,(s at time zone (p_task->>'timezone'))::time,p_task->>'timezone',p_task->>'recurrence',(p_task->>'repeat_until')::date) returning * into t;
 if s is not null and (s at time zone t.timezone)::date<>d then raise exception 'Schedule date mismatch';end if;
 insert into public.task_occurrences(user_id,task_id,source_date,local_date,planned_start,planned_end) values(uid,t.id,d,d,s,f) returning * into o;
 else
 update public.tasks set title=p_task->>'title',description=p_task->>'description',category=p_task->>'category',priority=(p_task->>'priority')::int,due_at=(p_task->>'due_at')::timestamptz,due_date=(p_task->>'due_date')::date,due_certainty=p_task->>'due_certainty',estimated_minutes=(p_task->>'estimated_minutes')::int,optional=(p_task->>'optional')::boolean where id=(p_task->>'id')::uuid and user_id=uid and version=p_task_version and not archived returning * into t;
 if not found then raise exception 'Conflict: task changed or unavailable' using errcode='40001';end if;
 if s is not null and (s at time zone t.timezone)::date<>d then raise exception 'Schedule date mismatch';end if;
 update public.task_occurrences set local_date=d,planned_start=s,planned_end=f where id=(p_occurrence->>'id')::uuid and task_id=t.id and user_id=uid and version=p_occurrence_version returning * into o;
 if not found then raise exception 'Conflict: occurrence changed or unavailable' using errcode='40001';end if;
 end if;
 return jsonb_build_object('task',to_jsonb(t),'occurrence',to_jsonb(o));
end;$$;
create or replace function public.save_planner_event(p_event jsonb,p_occurrence jsonb,p_event_version integer default null,p_occurrence_version integer default null,p_confirm_fixed boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); e public.calendar_events; o public.event_occurrences; d date:=(p_occurrence->>'local_date')::date; s timestamptz:=(p_occurrence->>'start_at')::timestamptz; f timestamptz:=(p_occurrence->>'end_at')::timestamptz;
begin
 if uid is null then raise exception 'Authentication required';end if;
 if d is null or s is null or f is null then raise exception 'Event date and times required';end if;
 if p_event->>'id' is null then
 if not exists(select 1 from pg_timezone_names where name=p_event->>'timezone') then raise exception 'Invalid timezone';end if;
 insert into public.calendar_events(user_id,title,description,category,fixed,start_at,end_at,timezone,recurrence,repeat_until) values(uid,p_event->>'title',p_event->>'description',p_event->>'category',(p_event->>'fixed')::boolean,s,f,p_event->>'timezone',p_event->>'recurrence',(p_event->>'repeat_until')::date) returning * into e;
 if (s at time zone e.timezone)::date<>d then raise exception 'Schedule date mismatch';end if;
 insert into public.event_occurrences(user_id,event_id,source_date,local_date,start_at,end_at) values(uid,e.id,d,d,s,f) returning * into o;
 else
 select * into e from public.calendar_events where id=(p_event->>'id')::uuid and user_id=uid and version=p_event_version and not archived for update;
 if not found then raise exception 'Conflict: event changed or unavailable' using errcode='40001';end if;
 if e.fixed and not p_confirm_fixed then raise exception 'Explicit confirmation required for a fixed event';end if;
 if (s at time zone e.timezone)::date<>d then raise exception 'Schedule date mismatch';end if;
 update public.calendar_events set title=p_event->>'title',description=p_event->>'description',category=p_event->>'category',fixed=(p_event->>'fixed')::boolean where id=e.id returning * into e;
 update public.event_occurrences set local_date=d,start_at=s,end_at=f where id=(p_occurrence->>'id')::uuid and event_id=e.id and user_id=uid and version=p_occurrence_version returning * into o;
 if not found then raise exception 'Conflict: occurrence changed or unavailable' using errcode='40001';end if;
 end if;
 return jsonb_build_object('event',to_jsonb(e),'occurrence',to_jsonb(o));
end;$$;
create or replace function public.set_planner_status(p_kind text,p_id uuid,p_version integer,p_status text,p_actual_minutes integer default 0,p_note text default '',p_skip_reason text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
 if uid is null then raise exception 'Authentication required';end if;
 if p_kind='task' then
 update public.task_occurrences set status=p_status,actual_minutes=p_actual_minutes,completion_note=p_note,skip_reason=p_skip_reason where id=p_id and user_id=uid and version=p_version returning to_jsonb(task_occurrences.*) into result;
 elsif p_kind='event' then
 update public.event_occurrences set status=p_status,completion_note=p_note where id=p_id and user_id=uid and version=p_version returning to_jsonb(event_occurrences.*) into result;
 else raise exception 'Invalid kind';end if;
 if result is null then raise exception 'Conflict: record changed or unavailable' using errcode='40001';end if;
 return result;
end;$$;
create or replace function public.archive_planner_item(p_kind text,p_id uuid,p_version integer,p_archived boolean,p_confirm_fixed boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); e public.calendar_events;
begin
 if uid is null then raise exception 'Authentication required';end if;
 if p_kind='task' then
 update public.tasks set archived=p_archived where id=p_id and user_id=uid and version=p_version;
 if not found then raise exception 'Conflict: task changed or unavailable' using errcode='40001';end if;
 elsif p_kind='event' then
 select * into e from public.calendar_events where id=p_id and user_id=uid and version=p_version for update;
 if not found then raise exception 'Conflict: event changed or unavailable' using errcode='40001';end if;
 if e.fixed and not p_confirm_fixed then raise exception 'Explicit confirmation required for a fixed event';end if;
 update public.calendar_events set archived=p_archived where id=p_id and user_id=uid;
 else raise exception 'Invalid kind';end if;
end;$$;
revoke all on function public.ensure_planner_occurrences(date,date),public.save_planner_task(jsonb,jsonb,integer,integer),public.save_planner_event(jsonb,jsonb,integer,integer,boolean),public.set_planner_status(text,uuid,integer,text,integer,text,text),public.archive_planner_item(text,uuid,integer,boolean,boolean) from public,anon;
grant execute on function public.ensure_planner_occurrences(date,date),public.save_planner_task(jsonb,jsonb,integer,integer),public.save_planner_event(jsonb,jsonb,integer,integer,boolean),public.set_planner_status(text,uuid,integer,text,integer,text,text),public.archive_planner_item(text,uuid,integer,boolean,boolean) to authenticated;
commit;
