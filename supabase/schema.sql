-- ============================================================
-- CORTEXA — Supabase setup script
-- Run this ONCE: Supabase Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

create extension if not exists vector;

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- DOCUMENTS ----------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  source_type text not null check (source_type in ('pdf', 'text', 'url')),
  source_url text,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error text,
  char_count integer not null default 0,
  chunk_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- CHUNKS (vector store) ----------
create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  idx integer not null default 0,
  content text not null,
  embedding vector(768) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chunks_embedding_hnsw
  on public.chunks using hnsw (embedding vector_cosine_ops);
create index if not exists chunks_document_idx
  on public.chunks (document_id);

-- ---------- NOTES ----------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  content text not null default '',
  kind text not null default 'note' check (kind in ('note', 'quiz')),
  created_by text not null default 'user' check (created_by in ('user', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- CHATS & MESSAGES ----------
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  mode text not null default 'auto' check (mode in ('ask', 'agent', 'auto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  trace jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_idx on public.messages (chat_id, created_at);

-- ---------- MEMORIES (persistent agent memory) ----------
-- Durable facts the assistant has learned about the user, written back
-- after interactions and recalled semantically on later turns.
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'fact'
    check (kind in ('fact', 'preference', 'goal', 'event', 'skill')),
  content text not null,
  embedding vector(768),
  source text not null default 'auto' check (source in ('auto', 'agent', 'user')),
  source_chat_id uuid references public.chats (id) on delete set null,
  confidence double precision not null default 0.7,
  pinned boolean not null default false,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_embedding_hnsw
  on public.memories using hnsw (embedding vector_cosine_ops);
create index if not exists memories_user_idx
  on public.memories (user_id, updated_at desc);


-- ============================================================
-- MIGRATIONS — make an EXISTING database match the definitions above.
-- `create table if not exists` skips tables that already exist, so any
-- constraint that changed has to be re-applied explicitly here.
-- Safe to run on a fresh database too.
-- ============================================================
do $$
begin
  -- 'auto' mode (the agentic router) was added after the first release.
  alter table public.chats drop constraint if exists chats_mode_check;
  alter table public.chats
    add constraint chats_mode_check check (mode in ('ask', 'agent', 'auto'));
  alter table public.chats alter column mode set default 'auto';
end $$;

-- ============================================================
-- ROW LEVEL SECURITY — every user sees ONLY their own rows
-- ============================================================
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.notes enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;

do $$
declare t text;
begin
  -- these tables carry a user_id column
  foreach t in array array['documents', 'chunks', 'notes', 'chats', 'messages', 'memories'] loop
    execute format('drop policy if exists "own_rows" on public.%I;', t);
    execute format(
      'create policy "own_rows" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);', t);
  end loop;

  -- profiles is the exception: its owner column is `id` (it IS the auth user row)
  execute 'drop policy if exists "own_rows" on public.profiles;';
  execute 'drop policy if exists "own_profile" on public.profiles;';
  execute 'create policy "own_profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());';
end $$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

-- memories deliberately has NO touch trigger: touch_memories() bumps usage
-- stats on every recall, and we don't want that to reorder the user's list.
-- updated_at is set explicitly by the app when content actually changes.

drop trigger if exists chats_touch on public.chats;
create trigger chats_touch before update on public.chats
  for each row execute function public.touch_updated_at();

-- ============================================================
-- VECTOR SEARCH — returns most similar chunks for the caller only
-- SECURITY INVOKER (default): auth.uid() inside respects real user
-- ============================================================
create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count integer default 6,
  min_similarity double precision default 0.15
)
returns table (
  id uuid,
  document_id uuid,
  document_title text,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select c.id,
         c.document_id,
         d.title as document_title,
         c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = auth.uid()
    and d.status = 'ready'
    and 1 - (c.embedding <=> query_embedding) > min_similarity
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

-- ============================================================
-- MEMORY SEARCH — semantic recall over the caller's own memories
-- ============================================================
create or replace function public.match_memories(
  query_embedding vector(768),
  match_count integer default 6,
  min_similarity double precision default 0.30
)
returns table (
  id uuid,
  kind text,
  content text,
  pinned boolean,
  confidence double precision,
  updated_at timestamptz,
  similarity double precision
)
language sql
stable
as $$
  select m.id,
         m.kind,
         m.content,
         m.pinned,
         m.confidence,
         m.updated_at,
         1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where m.user_id = auth.uid()
    and m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) > min_similarity
  order by m.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

-- Bump usage stats when a memory actually gets used in an answer.
create or replace function public.touch_memories(memory_ids uuid[])
returns void
language sql
volatile
as $$
  update public.memories
     set use_count = use_count + 1,
         last_used_at = now()
   where user_id = auth.uid()
     and id = any(memory_ids);
$$;
