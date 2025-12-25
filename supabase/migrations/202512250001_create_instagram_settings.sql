create table if not exists public.instagram_settings (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'global',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists instagram_settings_scope_unique on public.instagram_settings(scope);

alter table public.instagram_settings disable row level security;

