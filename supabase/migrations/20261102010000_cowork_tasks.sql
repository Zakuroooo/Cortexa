-- ============================================================
-- COWORK TASK MODE — 5 tables + lease function
-- The user gives a goal, Cortexa makes a plan (task_steps), runs one step
-- per request (step_runs), saves outputs (task_artifacts) and records every
-- yes/no decision (task_approvals). Every table has RLS: own rows only.
-- Safe to run more than once.
-- ============================================================

-- ---------- TASKS ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal text not null check (char_length(goal) between 1 and 2000),
  title text not null default 'New task',
  status text not null default 'planning'
    check (status in ('planning', 'awaiting_approval', 'running',
                      'waiting_approval', 'succeeded', 'failed', 'cancelled')),
  error text,
  budget_steps integer not null default 8,
  token_budget integer not null default 60000,
  tokens_used integer not null default 0,
  -- the lease: whoever sets this first runs the next step (see claim_task)
  lease_until timestamptz,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists tasks_user_idx on public.tasks (user_id, created_at desc);

-- ---------- TASK STEPS (the plan) ----------
create table if not exists public.task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  idx integer not null,
  title text not null,
  instruction text not null default '',
  kind text not null
    check (kind in ('research', 'read_docs', 'analyze', 'write', 'artifact', 'save_to_workspace')),
  tools text[] not null default '{}',
  needs_approval boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'waiting_approval', 'running', 'done', 'failed', 'skipped')),
  output text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_steps_task_idx on public.task_steps (task_id, idx);

-- ---------- STEP RUNS (one row per attempt, with the live event log) ----------
create table if not exists public.step_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  step_id uuid not null references public.task_steps (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempt integer not null default 1,
  status text not null default 'running'
    check (status in ('running', 'done', 'failed')),
  events jsonb not null default '[]'::jsonb,
  error text,
  tokens integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists step_runs_step_idx on public.step_runs (step_id, attempt);

-- ---------- ARTIFACTS (the files the task produces) ----------
create table if not exists public.task_artifacts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  step_id uuid references public.task_steps (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  format text not null check (format in ('md', 'csv', 'json')),
  content text not null check (octet_length(content) <= 1000000),
  created_at timestamptz not null default now()
);

create index if not exists task_artifacts_task_idx on public.task_artifacts (task_id, created_at);

-- ---------- APPROVALS (audit trail of every yes / no) ----------
create table if not exists public.task_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  step_id uuid references public.task_steps (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('plan', 'step')),
  decision text not null check (decision in ('approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- ---------- RLS: every user sees ONLY their own rows ----------
do $$
declare t text;
begin
  foreach t in array array['tasks', 'task_steps', 'step_runs', 'task_artifacts', 'task_approvals'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "own_rows" on public.%I;', t);
    execute format(
      'create policy "own_rows" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);', t);
  end loop;
end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

drop trigger if exists task_steps_touch on public.task_steps;
create trigger task_steps_touch before update on public.task_steps
  for each row execute function public.touch_updated_at();

-- ============================================================
-- LEASE — atomic claim, so two ticks can never run the same task at once.
-- One UPDATE … WHERE lease is free … RETURNING. Postgres locks the row, so
-- only one caller gets it back; the other gets zero rows and walks away.
-- SECURITY INVOKER (default): RLS still applies, you can only claim your own.
-- ============================================================
create or replace function public.claim_task(p_task_id uuid, p_seconds integer default 55)
returns setof public.tasks
language sql
volatile
as $$
  update public.tasks
     set lease_until = now() + make_interval(secs => p_seconds)
   where id = p_task_id
     and user_id = auth.uid()
     and status = 'running'
     and (lease_until is null or lease_until < now())
  returning *;
$$;

create or replace function public.release_task(p_task_id uuid)
returns void
language sql
volatile
as $$
  update public.tasks set lease_until = null
   where id = p_task_id and user_id = auth.uid();
$$;

-- Rate-limit action for task creation (the limiter table is shared).
-- Nothing to add: check_rate_limit() takes the action name as text.
