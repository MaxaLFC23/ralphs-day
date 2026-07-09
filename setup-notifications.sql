-- Ralph's Day: notifications setup. Run the whole file in the Supabase SQL Editor.

-- 1. Tables
create table if not exists push_subscriptions (
  endpoint text primary key,
  device text,
  sub jsonb,
  created_at timestamptz default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists "anon all" on push_subscriptions;
create policy "anon all" on push_subscriptions for all using (true) with check (true);

create table if not exists push_state (
  key text primary key,
  value jsonb
);
alter table push_state enable row level security;
drop policy if exists "anon all" on push_state;
create policy "anon all" on push_state for all using (true) with check (true);

-- 2. Extensions for triggers-over-HTTP and cron
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 3. Trigger: on every new event, call the notify-activity edge function
create or replace function notify_activity_fn() returns trigger
language plpgsql security definer as $$
begin
  perform net.http_post(
    url := 'https://chtlhdjzadjemudgksxm.supabase.co/functions/v1/notify-activity',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('record', row_to_json(new))
  );
  return new;
end $$;

drop trigger if exists trg_notify_activity on ralph_events;
create trigger trg_notify_activity
after insert on ralph_events
for each row execute function notify_activity_fn();

-- 4. Cron: reminders every 10 minutes
select cron.unschedule('ralph-reminders')
where exists (select 1 from cron.job where jobname = 'ralph-reminders');
select cron.schedule(
  'ralph-reminders',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://chtlhdjzadjemudgksxm.supabase.co/functions/v1/reminders',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
