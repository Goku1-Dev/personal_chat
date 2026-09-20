-- ===========================================================================
-- Private two-person chat — database schema
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query → paste → Run). It is written to be re-runnable: every object is
-- created with IF NOT EXISTS or replaced in place.
--
-- The security model in one line: the browser holds nothing but an ordinary
-- authenticated session, and every rule about who may read or change what is
-- enforced here, by Postgres.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- NOTE: after running this file, also run
--   supabase/migrations/0002_delete_modes_and_replies.sql
-- which adds replies, per-person deletions and delete-for-everyone.


-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- One row per participant, linked 1:1 to an account in auth.users.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         text not null check (role in ('admin', 'user')),
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  created_at   timestamptz not null default now()
);

-- Exactly one admin and one user. The partial unique index is what stops a
-- second admin from ever being created.
create unique index if not exists profiles_one_per_role_idx
  on public.profiles (role);

comment on table public.profiles is
  'The two participants. Rows are created by the operator, never by the app.';

-- The conversation itself. This app expects exactly one.
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  title      text,
  created_at timestamptz not null default now()
);

-- Who is allowed into which conversation.
create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,

  -- Defaulted to the caller's own id, and pinned there by RLS and by the
  -- immutability trigger below. A browser cannot send on someone's behalf.
  sender_id       uuid not null default auth.uid()
                    references public.profiles (id) on delete cascade,

  content         text not null check (char_length(content) between 0 and 4000),
  message_type    text not null default 'text' check (message_type in ('text', 'image')),
  media_path      text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Set automatically the first time the content changes.
  edited_at       timestamptz,

  -- Set by mark_messages_read(), only ever by the recipient.
  read_at         timestamptz,

  -- Reserved for a future soft-delete mode. The app deletes rows outright,
  -- so this stays null; it exists so switching later needs no migration.
  deleted_at      timestamptz
);

-- "Clear chat" hides history for one person without touching the messages.
create table if not exists public.chat_clears (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  cleared_at      timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

comment on table public.chat_clears is
  'Per-participant "hide everything before this instant". Deletes nothing.';

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Serves the main query: newest page of one conversation, plus the keyset
-- pagination that walks backwards from it.
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

create index if not exists messages_sender_idx
  on public.messages (sender_id);

-- "Delete all my messages" and the per-sender counters.
create index if not exists messages_conversation_sender_idx
  on public.messages (conversation_id, sender_id);

-- Unread lookups.
create index if not exists messages_unread_idx
  on public.messages (conversation_id, sender_id)
  where read_at is null;

create index if not exists conversation_participants_profile_idx
  on public.conversation_participants (profile_id);

-- ---------------------------------------------------------------------------
-- 3. Helper functions
--
-- Both are SECURITY DEFINER so that a policy on one table can look at another
-- without re-entering RLS and recursing. Both pin search_path, which is what
-- stops a definer function from being hijacked by a rogue schema.
-- ---------------------------------------------------------------------------

create or replace function public.is_participant(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.conversation_participants cp
     where cp.conversation_id = p_conversation_id
       and cp.profile_id = auth.uid()
  );
$$;

-- True when the caller and p_profile_id sit in the same conversation. Used so
-- each participant can read the other's display name and nobody else's.
create or replace function public.shares_conversation(p_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.conversation_participants mine
      join public.conversation_participants theirs
        on theirs.conversation_id = mine.conversation_id
     where mine.profile_id = auth.uid()
       and theirs.profile_id = p_profile_id
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------

-- Ownership and provenance are immutable. Even with a valid session and a
-- hand-written request, an update cannot move a message to another sender or
-- another conversation, and cannot forge its own read receipt.
create or replace function public.messages_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'id cannot be changed' using errcode = '42501';
  end if;

  if new.conversation_id is distinct from old.conversation_id then
    raise exception 'conversation_id cannot be changed' using errcode = '42501';
  end if;

  if new.sender_id is distinct from old.sender_id then
    raise exception 'sender_id cannot be changed' using errcode = '42501';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'created_at cannot be changed' using errcode = '42501';
  end if;

  -- Only the person who did NOT write the message may change its read state,
  -- and only through mark_messages_read().
  if new.read_at is distinct from old.read_at and auth.uid() = old.sender_id then
    raise exception 'read_at cannot be set by the sender' using errcode = '42501';
  end if;

  new.updated_at := now();

  if new.content is distinct from old.content then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_guard_update_trg on public.messages;
create trigger messages_guard_update_trg
  before update on public.messages
  for each row execute function public.messages_guard_update();

-- A conversation in this app holds two people. Not one, not three.
create or replace function public.enforce_two_participants()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing integer;
begin
  select count(*) into existing
    from public.conversation_participants
   where conversation_id = new.conversation_id;

  if existing >= 2 then
    raise exception 'A conversation can only have two participants'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists conversation_participants_limit_trg
  on public.conversation_participants;
create trigger conversation_participants_limit_trg
  before insert on public.conversation_participants
  for each row execute function public.enforce_two_participants();

-- ---------------------------------------------------------------------------
-- 5. Read receipts
--
-- RLS lets a participant update only their own messages, so a reader cannot
-- write read_at directly. This definer function is the single narrow door:
-- it marks the *other* person's messages, in one conversation, as read.
-- ---------------------------------------------------------------------------

create or replace function public.mark_messages_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  if auth.uid() is null or not public.is_participant(p_conversation_id) then
    raise exception 'Not a participant of this conversation' using errcode = '42501';
  end if;

  update public.messages
     set read_at = now()
   where conversation_id = p_conversation_id
     and sender_id <> auth.uid()
     and read_at is null;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles                 enable row level security;
alter table public.conversations            enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                 enable row level security;
alter table public.chat_clears              enable row level security;

-- Belt and braces: even if a policy were dropped by mistake, the table owner
-- is still subject to RLS.
alter table public.profiles                 force row level security;
alter table public.conversations            force row level security;
alter table public.conversation_participants force row level security;
alter table public.messages                 force row level security;
alter table public.chat_clears              force row level security;

-- profiles ------------------------------------------------------------------
-- Readable: yourself, and the one person you share a conversation with.
-- Writable: nobody through the API. The operator manages these rows.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_conversation(id));

-- conversations -------------------------------------------------------------
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using (public.is_participant(id));

-- conversation_participants -------------------------------------------------
drop policy if exists conversation_participants_select
  on public.conversation_participants;
create policy conversation_participants_select on public.conversation_participants
  for select to authenticated
  using (public.is_participant(conversation_id));

-- messages ------------------------------------------------------------------

-- Read every message in your own conversation, and nothing outside it.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (public.is_participant(conversation_id));

-- Write only as yourself, only into your own conversation. A forged
-- sender_id in the request body fails this check.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_participant(conversation_id)
  );

-- Edit only your own. The USING clause decides which rows you may touch; the
-- WITH CHECK clause stops the update from handing the row to someone else.
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (sender_id = auth.uid() and public.is_participant(conversation_id))
  with check (sender_id = auth.uid());

-- Delete only your own.
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (sender_id = auth.uid() and public.is_participant(conversation_id));

-- chat_clears ---------------------------------------------------------------
-- Entirely private: your clear point is yours to read and set.
drop policy if exists chat_clears_select on public.chat_clears;
create policy chat_clears_select on public.chat_clears
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists chat_clears_insert on public.chat_clears;
create policy chat_clears_insert on public.chat_clears
  for insert to authenticated
  with check (profile_id = auth.uid() and public.is_participant(conversation_id));

drop policy if exists chat_clears_update on public.chat_clears;
create policy chat_clears_update on public.chat_clears
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists chat_clears_delete on public.chat_clears;
create policy chat_clears_delete on public.chat_clears
  for delete to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. Grants
--
-- anon gets nothing. Every table is reachable only by a signed-in session,
-- and then only through the policies above.
-- ---------------------------------------------------------------------------

revoke all on public.profiles                  from anon;
revoke all on public.conversations             from anon;
revoke all on public.conversation_participants from anon;
revoke all on public.messages                  from anon;
revoke all on public.chat_clears               from anon;

grant select on public.profiles                  to authenticated;
grant select on public.conversations             to authenticated;
grant select on public.conversation_participants to authenticated;
grant select, insert, update, delete on public.messages    to authenticated;
grant select, insert, update, delete on public.chat_clears to authenticated;

revoke all on function public.mark_messages_read(uuid) from public, anon;
grant execute on function public.mark_messages_read(uuid) to authenticated;

grant execute on function public.is_participant(uuid)      to authenticated;
grant execute on function public.shares_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Realtime
--
-- REPLICA IDENTITY FULL makes DELETE events carry the old row, so the other
-- browser learns which message disappeared instead of just "something did".
-- ---------------------------------------------------------------------------

alter table public.messages replica identity full;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. One-time setup helper
--
-- Create the two accounts first (Dashboard → Authentication → Users → Add
-- user, with "Auto Confirm User" ticked), copy their UUIDs, then run:
--
--   select public.setup_participants(
--     'ADMIN-UUID-HERE'::uuid, 'Admin display name',
--     'USER-UUID-HERE'::uuid,  'Their display name',
--     'Our Chat'
--   );
--
-- Running it again updates the names and leaves the conversation alone.
-- ---------------------------------------------------------------------------

create or replace function public.setup_participants(
  p_admin_id    uuid,
  p_admin_name  text,
  p_user_id     uuid,
  p_user_name   text,
  p_title       text default 'Our Chat'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation_id uuid;
begin
  if p_admin_id = p_user_id then
    raise exception 'The two participants must be different accounts';
  end if;

  insert into public.profiles (id, role, display_name)
  values (p_admin_id, 'admin', p_admin_name)
  on conflict (id) do update set display_name = excluded.display_name;

  insert into public.profiles (id, role, display_name)
  values (p_user_id, 'user', p_user_name)
  on conflict (id) do update set display_name = excluded.display_name;

  select id into v_conversation_id from public.conversations order by created_at limit 1;

  if v_conversation_id is null then
    insert into public.conversations (title)
    values (p_title)
    returning id into v_conversation_id;
  else
    update public.conversations set title = p_title where id = v_conversation_id;
  end if;

  insert into public.conversation_participants (conversation_id, profile_id)
  values (v_conversation_id, p_admin_id)
  on conflict do nothing;

  insert into public.conversation_participants (conversation_id, profile_id)
  values (v_conversation_id, p_user_id)
  on conflict do nothing;

  return v_conversation_id;
end;
$$;

-- Operator-only: never callable from a browser session.
revoke all on function
  public.setup_participants(uuid, text, uuid, text, text)
  from public, anon, authenticated;


-- Chat image storage
insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', true) on conflict (id) do update set public = true;

drop policy if exists chat_media_insert on storage.objects;
create policy chat_media_insert on storage.objects for insert to authenticated with check (bucket_id = 'chat-media' and split_part(name, '/', 1) in (select cp.conversation_id::text from public.conversation_participants cp where cp.profile_id = auth.uid()));

drop policy if exists chat_media_delete on storage.objects;
create policy chat_media_delete on storage.objects for delete to authenticated using (bucket_id = 'chat-media' and split_part(name, '/', 1) in (select cp.conversation_id::text from public.conversation_participants cp where cp.profile_id = auth.uid()));
