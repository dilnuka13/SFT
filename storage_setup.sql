-- Create the storage bucket for avatars
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Set up access policies for the avatars bucket
-- 1. Allow anyone to view avatars
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'avatars' );

-- 2. Allow authenticated users to upload avatars
-- Since we are using custom auth (password_hash), we might need to allow public inserts if not using Supabase Auth
-- But for now, let's allow all inserts to this bucket for simplicity, or restricted by bucket_id
create policy "Public Upload"
on storage.objects for insert
with check ( bucket_id = 'avatars' );

-- 3. Allow users to update their own avatars (simplified to public for now to match the "Bucket not found" fix)
create policy "Public Update"
on storage.objects for update
using ( bucket_id = 'avatars' );
