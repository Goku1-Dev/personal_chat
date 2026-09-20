-- ===========================================================================
-- 0002 — delete for me, delete for everyone, and replies
--
-- Run this in the Supabase SQL editor on the existing project. It is
-- idempotent: every statement is guarded, so running it twice is harmless.
--
-- What changes, in one line: either participant may now delete any message
-- for everyone, but nobody may edit anybody else's words — and that split is
-- enforced by Postgres, not by React.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns on messages
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists reply_to_message_id uuid
    references public.messages (id) on delete set null;

alter table public.messages
  add column if not exists deleted_for_everyone boolean not null default false;

alter table public.messages
  add column if not exists deleted_by uuid
    references public.profiles (id) on delete set null;

-- Added live for the image feature; declared here so a fresh database matches.
alter table public.messages
  add column if not exists media_path text;

comment on column public.messages.deleted_for_everyone is
  'True once the text has been cleared for both participants. The row stays so replies keep a valid target.';

-- A message cannot be its own parent.
alter table public.messages drop constraint if exists messages_reply_not_self_check;
alter table public.messages
  add constraint messages_reply_not_self_check
  check (reply_to_message_id is null or reply_to_message_id <> id);

-- message_type gained 'image' in the live database; make that official.
alter table public.messages drop constraint if exists messages_message_type_check;
alter table public.messages
  add constraint messages_message_type_check
  check (message_type in ('text', 'image'));

-- Content must be non-empty for a live message, and is emptied outright when
-- a message is deleted for everyone. Blanking it here — rather than only
-- hiding it in the client — is what makes "neither of us can see it" true.
-- The original constraint was declared inline, so its generated name depends
-- on how the table was created. Drop whatever currently constrains content.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.messages'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%char_length(content)%'
  loop
    execute format('alter table public.messages drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.messages
  add constraint messages_content_check
  check (
    char_length(content) <= 4000
    and (deleted_for_everyone or char_length(btrim(content)) > 0 or (message_type = 'image' and media_path is not null))
  );

-- ---------------------------------------------------------------------------
-- 2. Per-person deletions ("delete for me")
--
-- If this table already exists with different column names, drop it first —
-- it holds only per-person hide state and can be rebuilt safely:
--   drop table if exists public.message_deletions;
-- ---------------------------------------------------------------------------

create table if not exists public.message_deletions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  deleted_at timestamptz not null default now()
);

-- The client upserts on this pair, so the constraint has to exist.
create unique index if not exists message_deletions_unique_idx
  on public.message_deletions (message_id, profile_id);

comment on table public.message_deletions is
  'One row per (message, person) that this person has hidden. Never deletes the message itself.';

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

create index if not exists message_deletions_profile_idx
  on public.message_deletions (profile_id);

create index if not exists message_deletions_message_idx
  on public.message_deletions (message_id);

create index if not exists messages_reply_to_idx
  on public.messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Update guard
--
-- Replaces the trigger function from schema.sql. Ownership stays immutable,
-- and three new rules are added:
--   * a message deleted for everyone can never be edited again
--   * deleted_for_everyone can only be set through the RPC below
--   * a deletion can never be undone
-- ---------------------------------------------------------------------------

create or replace function public.messages_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  via_rpc boolean := coalesce(
    current_setting('app.delete_for_everyone', true) = 'on', false
  );
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

  if new.reply_to_message_id is distinct from old.reply_to_message_id then
    raise exception 'reply_to_message_id cannot be changed' using errcode = '42501';
  end if;

  -- Nothing survives a delete-for-everyone except the read receipt.
  if old.deleted_for_everyone and not via_rpc then
    -- The one thing still allowed on a deleted message is the recipient
    -- marking it read, so an unread count cannot get stuck.
    if new.read_at is distinct from old.read_at
       and auth.uid() is distinct from old.sender_id
       and new.content is not distinct from old.content
    then
      new.updated_at := now();
      new.edited_at := old.edited_at;
      return new;
    end if;
    raise exception 'This message was deleted' using errcode = '42501';
  end if;

  if new.deleted_for_everyone is distinct from old.deleted_for_everyone then
    if not via_rpc then
      raise exception 'Use delete_messages_for_everyone() to delete a message'
        using errcode = '42501';
    end if;
    if not new.deleted_for_everyone then
      raise exception 'A deleted message cannot be restored' using errcode = '42501';
    end if;
  end if;

  -- Only the person who did NOT write the message may change its read state.
  if new.read_at is distinct from old.read_at and auth.uid() = old.sender_id then
    raise exception 'read_at cannot be set by the sender' using errcode = '42501';
  end if;

  new.updated_at := now();

  -- Blanking the text during a delete is not an edit.
  if via_rpc and new.deleted_for_everyone then
    new.edited_at := old.edited_at;
  elsif new.content is distinct from old.content then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Delete RPCs
--
-- Both take an array and run as a single statement, so selecting every
-- message in the chat is one round trip and one transaction, not one request
-- per message.
-- ---------------------------------------------------------------------------

-- "Delete for everyone": either participant, any message in their own
-- conversation, regardless of who wrote it. Ids outside the caller's
-- conversation are silently skipped rather than reported, so this cannot be
-- used to probe for messages elsewhere.
create or replace function public.delete_messages_for_everyone(p_message_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if p_message_ids is null or array_length(p_message_ids, 1) is null then
    return 0;
  end if;

  perform set_config('app.delete_for_everyone', 'on', true);

  update public.messages m
     set deleted_for_everyone = true,
         deleted_at           = now(),
         deleted_by           = auth.uid(),
         content              = '',
         media_path           = null
   where m.id = any (p_message_ids)
     and m.deleted_for_everyone = false
     and public.is_participant(m.conversation_id);

  get diagnostics affected = row_count;

  perform set_config('app.delete_for_everyone', 'off', true);

  return affected;
end;
$$;

-- "Delete for me": hides messages for the caller alone. The other person's
-- view is untouched, and the message itself is never removed.
create or replace function public.delete_messages_for_me(p_message_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if p_message_ids is null or array_length(p_message_ids, 1) is null then
    return 0;
  end if;

  insert into public.message_deletions (message_id, profile_id)
  select m.id, auth.uid()
    from public.messages m
   where m.id = any (p_message_ids)
     and public.is_participant(m.conversation_id)
  on conflict (message_id, profile_id) do nothing;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The view the app reads
--
-- security_invoker means the caller's own RLS still applies; this view adds
-- two things on top: it drops whatever the caller has hidden, and it resolves
-- the quoted parent of a reply in the same round trip.
-- ---------------------------------------------------------------------------

create or replace view public.messages_visible
with (security_invoker = true) as
select
  m.id,
  m.conversation_id,
  m.sender_id,
  m.content,
  m.message_type,
  m.media_path,
  m.created_at,
  m.updated_at,
  m.edited_at,
  m.read_at,
  m.deleted_at,
  m.deleted_for_everyone,
  m.deleted_by,
  m.reply_to_message_id,
  parent.sender_id as reply_to_sender_id,

  -- The quoted text is withheld when the parent is gone for everyone, and
  -- also when the caller has hidden it for themselves: a reply must not put
  -- back what you chose not to see.
  case
    when parent.id is null then null
    when parent.deleted_for_everyone then null
    when exists (
      select 1 from public.message_deletions pd
       where pd.message_id = parent.id and pd.profile_id = auth.uid()
    ) then null
    else case when parent.message_type = 'image' then 'Photo' else parent.content end
  end as reply_to_content,

  (
    m.reply_to_message_id is not null
    and (
      parent.id is null
      or parent.deleted_for_everyone
      or exists (
        select 1 from public.message_deletions pd
         where pd.message_id = parent.id and pd.profile_id = auth.uid()
      )
    )
  ) as reply_to_unavailable

from public.messages m
left join public.messages parent on parent.id = m.reply_to_message_id
where not exists (
  select 1
    from public.message_deletions d
   where d.message_id = m.id
     and d.profile_id = auth.uid()
);

-- ---------------------------------------------------------------------------
-- 7. Row level security on message_deletions
--
-- Your hide-list is yours alone: you cannot read, create, or clear anyone
-- else's, and you can only hide a message from a conversation you are in.
-- ---------------------------------------------------------------------------

alter table public.message_deletions enable row level security;
alter table public.message_deletions force row level security;

drop policy if exists message_deletions_select on public.message_deletions;
create policy message_deletions_select on public.message_deletions
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists message_deletions_insert on public.message_deletions;
create policy message_deletions_insert on public.message_deletions
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.messages m
       where m.id = message_id
         and public.is_participant(m.conversation_id)
    )
  );

-- Allowed so an "undo" can be built later; harmless today.
drop policy if exists message_deletions_delete on public.message_deletions;
create policy message_deletions_delete on public.message_deletions
  for delete to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. Message policies
--
-- Unchanged in spirit: you may still only edit and hard-delete your own.
-- Deleting someone else's message for everyone goes through the RPC, which is
-- the only path that can set the flag.
-- ---------------------------------------------------------------------------

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (sender_id = auth.uid() and public.is_participant(conversation_id))
  with check (sender_id = auth.uid());

-- A reply may only point at a message in the same conversation.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_participant(conversation_id)
    and (
      reply_to_message_id is null
      or exists (
        select 1 from public.messages parent
         where parent.id = reply_to_message_id
           and parent.conversation_id = messages.conversation_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------

revoke all on public.message_deletions from anon;
grant select, insert, delete on public.message_deletions to authenticated;

revoke all on public.messages_visible from anon;
grant select on public.messages_visible to authenticated;

revoke all on function public.delete_messages_for_everyone(uuid[]) from public, anon;
grant execute on function public.delete_messages_for_everyone(uuid[]) to authenticated;

revoke all on function public.delete_messages_for_me(uuid[]) from public, anon;
grant execute on function public.delete_messages_for_me(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Realtime
--
-- messages is already published. Adding message_deletions keeps a second tab
-- belonging to the same person in step when they hide something.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'message_deletions'
  ) then
    alter publication supabase_realtime add table public.message_deletions;
  end if;
end;
$$;
