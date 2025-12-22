create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema extensions;

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
  list_id uuid,
  sessions_today integer not null default 0
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
  message boolean not null default false,
  subscribed_at timestamptz
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

-- Auto Unsubscribe function (preserve assigned_to)
create or replace function public.auto_unsubscribe_instagram()
returns void
language sql
security definer
set search_path = public
as $$
update public.instagram_accounts
set status = 'unsubscribed'
where (status = 'sunscribed' or status = 'subscribed')
  and subscribed_at is not null
  and subscribed_at <= now() - interval '7 days';
$$;

-- Daily assignment of available accounts (30..40 per profile)
create or replace function public.assign_available_accounts_daily()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  assign_count int;
begin
  for p in select profile_id from public.profiles loop
    assign_count := 30 + floor(random() * 11)::int; -- 30..40

    with picked as (
      select id
      from public.instagram_accounts
      where status = 'available' and assigned_to is null
      order by random()
      limit assign_count
    )
    update public.instagram_accounts ia
    set assigned_to = p.profile_id,
        status = 'assigned'
    from picked
    where ia.id = picked.id;
  end loop;
end;
$$;

-- Ensure cron jobs are (re)scheduled cleanly
do $$
declare jid int;
begin
  select jobid into jid from cron.job where jobname = 'auto_unsubscribe_instagram_job' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end
$$;

select cron.schedule('auto_unsubscribe_instagram_job', '0 3 * * *', $$select public.auto_unsubscribe_instagram();$$);

do $$
declare jid int;
begin
  select jobid into jid from cron.job where jobname = 'auto_assign_available_accounts_job' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end
$$;

select cron.schedule('auto_assign_available_accounts_job', '15 3 * * *', $$select public.assign_available_accounts_daily();$$);
