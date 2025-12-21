create extension if not exists pgcrypto;

create table public.profiles (
  profile_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  proxy text,
  status text,
  mode text,
  "Using" boolean not null default false,
  type text,
  test_ip boolean not null default false,
  user_agent text,
  list_id uuid
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  assigned_to uuid,
  created_at timestamptz not null default now(),
  status text,
  link_sent text,
  message boolean not null default false
);

alter table public.profiles
  add constraint profiles_list_id_fk foreign key (list_id)
  references public.lists(id)
  on delete set null;

alter table public.instagram_accounts
  add constraint instagram_accounts_assigned_to_fk foreign key (assigned_to)
  references public.profiles(profile_id)
  on delete set null;

create index if not exists idx_profiles_list_id on public.profiles(list_id);
create index if not exists idx_instagram_accounts_assigned_to on public.instagram_accounts(assigned_to);

alter table public.profiles disable row level security;
alter table public.lists disable row level security;
alter table public.instagram_accounts disable row level security;
