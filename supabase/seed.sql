insert into public.profiles (profile_id, created_at, name, proxy, status, mode, "Using", type, test_ip, user_agent)
values (gen_random_uuid(), now(), 'Default Profile', null, 'idle', 'default', false, 'standard', false, 'Mozilla/5.0');

insert into public.lists (id, name, created_at)
values (gen_random_uuid(), 'Default List', now());

update public.profiles p
set list_id = l.id
from public.lists l
where p.name = 'Default Profile'
and l.name = 'Default List';

insert into public.instagram_accounts (id, user_name, assigned_to, created_at, status, link_sent, message)
select gen_random_uuid(), 'example_user1', p.profile_id, now(), 'assigned', 'not send', false
from public.profiles p
where p.name = 'Default Profile'
union all
select gen_random_uuid(), 'example_user2', p.profile_id, now(), 'assigned', 'not send', true
from public.profiles p
where p.name = 'Default Profile'
union all
select gen_random_uuid(), 'example_user3', p.profile_id, now(), 'assigned', 'needed to send', false
from public.profiles p
where p.name = 'Default Profile';
