-- Product image storage.
--
-- Scans upload the photographed label to the `product-images` bucket and store
-- the resulting public URL in scanned_products.image_url.
--
-- Objects are keyed as:  product-images/<user_id>/<uuid>.jpg
-- The first path segment is the owner's auth.uid(), which is what the write
-- policies below key off, so a user can only touch their own folder.
--
-- If your role cannot create the bucket/policies from SQL, the same thing can
-- be done in the Dashboard: Storage -> New bucket (public), then the policy
-- editor on storage.objects.

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,                                              -- served over a public URL
  5242880,                                           -- 5 MB; images are downscaled client-side first
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Policies on storage.objects (RLS is already enabled by Supabase)
-- ---------------------------------------------------------------------------

-- Read: the bucket is public, so product photos can be shown in history cards
-- and shared reports without a signed URL.
drop policy if exists "Product images are publicly readable" on storage.objects;
create policy "Product images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- Write: only into your own <user_id>/ folder.
drop policy if exists "Users can upload their own product images" on storage.objects;
create policy "Users can upload their own product images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update their own product images" on storage.objects;
create policy "Users can update their own product images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own product images" on storage.objects;
create policy "Users can delete their own product images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
