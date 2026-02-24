-- Storage bucket for user avatars
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- RLS policies for avatars bucket
create policy "Avatar upload" on storage.objects
  for insert with check (
    bucket_id = 'avatars' 
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Avatar update" on storage.objects
  for update with check (
    bucket_id = 'avatars' 
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Avatar delete" on storage.objects
  for delete using (
    bucket_id = 'avatars' 
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Avatar public access" on storage.objects
  for select using (bucket_id = 'avatars');
