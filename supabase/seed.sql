insert into public.lists (id, name, created_at)
values ('58c8d761-5076-4c05-8404-4c504f37de11', 'test', '2025-12-23 17:22:27.512137+00')
on conflict do nothing;

insert into public.profiles (profile_id, created_at, name, proxy, status, mode, "Using", type, test_ip, user_agent, list_id, sessions_today, last_opened_at, ua_os, ua_browser)
values
('dc9810aa-679e-4bf0-9596-8b8a2ca571e0', '2025-12-23 17:16:23.331153+00', 'nastyarainy', null, 'idle', 'direct', false, 'Camoufox (рекомендуется)', true, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', '58c8d761-5076-4c05-8404-4c504f37de11', 0, '2025-12-27 10:46:20.479891+00', null, null),
('52be3284-f4b1-4d6b-971c-936b90940464', '2025-12-23 17:38:08.417572+00', 'nastya__rainy', null, 'idle', 'direct', false, 'Camoufox (рекомендуется)', false, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0', null, 0, '2025-12-27 10:24:07.220385+00', null, null),
('dc260437-9691-4dc0-a8ec-e10d98ca65a5', '2025-12-27 10:19:56.122864+00', 'test', '', 'idle', 'direct', false, 'Camoufox (рекомендуется)', false, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0', null, 0, '2025-12-27 10:45:52.921293+00', null, null)
on conflict do nothing;

insert into public.instagram_settings (id, scope, data, created_at, updated_at)
values ('3a96c518-25c9-4f58-8273-9271b904fdd4', 'global', '{"headless":false,"max_delay":10,"min_delay":5,"do_approve":true,"do_message":false,"do_unfollow":false,"enable_feed":false,"like_chance":100,"stories_max":3,"action_order":["Reels Scroll","Approve Requests","Follow","Unfollow","Send Messages","Feed Scroll","Watch Stories"],"enable_reels":false,"max_sessions":3,"enable_follow":false,"follow_chance":0,"watch_stories":true,"highlights_max":3,"highlights_min":1,"following_limit":900,"source_list_ids":["58c8d761-5076-4c05-8404-4c504f37de11"],"follow_max_count":3,"follow_min_count":1,"likes_percentage":30,"max_time_minutes":1,"min_time_minutes":1,"parallel_profiles":1,"reels_like_chance":30,"reels_skip_chance":30,"scroll_percentage":30,"automation_enabled":false,"unfollow_max_count":15,"unfollow_min_count":5,"carousel_max_slides":3,"reels_follow_chance":0,"reels_skip_max_time":2,"reels_skip_min_time":0.8,"use_private_profiles":true,"carousel_watch_chance":0,"feed_max_time_minutes":1,"feed_min_time_minutes":1,"header_order_expanded":false,"reels_normal_max_time":20,"reels_normal_min_time":5,"header_target_expanded":true,"reels_max_time_minutes":5,"reels_min_time_minutes":5,"messaging_cooldown_hours":2,"messaging_cooldown_enabled":true,"profile_reopen_cooldown_enabled":true,"profile_reopen_cooldown_minutes":30}'::jsonb, '2025-12-25 17:31:20.321485+00', '2025-12-26 20:02:57.93223+00')
on conflict do nothing;

insert into public.message_templates (id, kind, texts, created_at, updated_at)
values
('cf2c53e4-5c4d-4801-9aa2-35d8ceb57f3c', 'message', '["test","test2"]'::jsonb, '2025-12-25 17:37:27.483116+00', '2025-12-25 17:37:27.483116+00'),
('66c04bdb-695a-4c51-8ce7-3bc808f86b7e', 'message_2', '["test","ttt5"]'::jsonb, '2025-12-25 17:37:48.86108+00', '2025-12-25 17:37:48.86108+00')
on conflict do nothing;

insert into public.instagram_accounts (id, user_name, assigned_to, created_at, status, link_sent, message, subscribed_at, last_message_sent_at)
values
('d0176fe9-5a19-4ae2-bfd3-6d6a70403503', 'digital_endorphin', 'dc9810aa-679e-4bf0-9596-8b8a2ca571e0', '2025-12-23 17:17:59.492159+00', 'assigned', 'done', true, null, '2025-12-26 13:34:22.235541+00'),
('dc0097f2-3e87-48da-a3b1-523bd23ea477', 'ivanslava68', 'dc9810aa-679e-4bf0-9596-8b8a2ca571e0', '2025-12-23 17:19:26.577181+00', 'assigned', 'not send', false, null, null)
on conflict do nothing;
