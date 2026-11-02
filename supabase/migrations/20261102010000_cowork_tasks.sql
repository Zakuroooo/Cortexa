-- ============================================================
-- COWORK — task history (the agent itself runs in the browser tab)
-- cowork_tasks:  one row per goal the user ran
-- cowork_events: the timeline of that task (to-dos, tool calls, results)
-- Both tables: RLS, own rows only. They are a RECORD of what happened —
-- budgets and approvals are enforced in code, never read from these rows.
-- Safe to run more than once.
-- ============================================================

create table if not exists public.cowork_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal text not null check (char_length(goal) between 1 and 4000),
  folder_name text not null default '',
  folder_kind text not null default 'virtual' check (folder_kind in ('folder', 'virtual')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'stopped')),
  summary text not null default '',
  outputs text[] not null default '{}',
  todos jsonb not null default '[]'::jsonb,
  tokens_used integer not null default 0,
  turns integer not null default 0,
  verified boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists cowork_tasks_user_idx on public.cowork_tasks (user_id, created_at desc);

create table if not exists public.cowork_events (
  id bigserial primary key,
  task_id uuid not null references public.cowork_tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seq integer not null,
  type text not null,
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) <= 100000),
  created_at timestamptz not null default now()
);

create index if not exists cowork_events_task_idx on public.cowork_events (task_id, seq);

do $$
declare t text;
begin
  foreach t in array array['cowork_tasks', 'cowork_events'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "own_rows" on public.%I;', t);
    execute format(
      'create policy "own_rows" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);', t);
  end loop;
end $$;
