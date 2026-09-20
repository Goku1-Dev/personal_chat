-- 0003 — private-chat image storage
-- Uses a public bucket so image messages can render directly in the browser.
-- Upload/delete are still restricted to authenticated participants.

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do update set public = true;

drop policy if exists chat_media_insert on storage.objects;
create policy chat_media_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and split_part(name, '/', 1) in (
    select cp.conversation_id::text
    from public.conversation_participants cp
    where cp.profile_id = auth.uid()
  )
);

drop policy if exists chat_media_delete on storage.objects;
create policy chat_media_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-media'
  and split_part(name, '/', 1) in (select cp.conversation_id::text from public.conversation_participants cp where cp.profile_id = auth.uid())
);
