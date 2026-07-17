alter table public.gallery_images
add column if not exists vrchat_metadata jsonb;

comment on column public.gallery_images.vrchat_metadata is
'Privacy-filtered VRChat capture time, display names, and world name. Never store stable user/world IDs or private instance IDs.';
