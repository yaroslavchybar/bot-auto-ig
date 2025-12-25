create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  texts jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists message_templates_kind_unique on public.message_templates(kind);

alter table public.message_templates disable row level security;

