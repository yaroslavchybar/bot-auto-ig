alter table public.instagram_accounts
  add column if not exists last_message_sent_at timestamptz;
