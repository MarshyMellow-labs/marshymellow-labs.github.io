alter table public.gallery_images
add column if not exists vrchat_metadata jsonb;

comment on column public.gallery_images.vrchat_metadata is
'VRChat photo capture time, author, world, instance, and user details extracted before image compression.';
