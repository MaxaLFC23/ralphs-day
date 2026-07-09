# Ralph's Day — Notifications setup

Two kinds of push: **activity** ("💧 Wee outside ✅" when the other person logs something)
and **reminders** ("😴 Nap due", "💧 No wee logged for 90 mins"), sent even when the app
is closed. Quiet hours 21:30–06:30 UK, no reminders while he's napping, nap reminder once
per wake, wee reminder at most hourly.

## One-time setup (~20 mins, on the MacBook)

### 1. Supabase CLI

```bash
brew install supabase/tap/supabase
supabase login
cd ~/Downloads/ralphs-day
supabase link --project-ref chtlhdjzadjemudgksxm
```

### 2. Secrets (the private half of the push keypair)

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY="BBZzXpYh6a2S9l14vvl_YubQWJSu5O0Z4TTruHJ8Gw8MlcVn8ehjnBhwjJEH7LZKvjX2Km09B3WVTWW7HpknPO0" \
  VAPID_PRIVATE_KEY="loprrFmOQ8ET5Vq1jia4BpIinVxzF4VzqxgtosO54lw" \
  VAPID_SUBJECT="mailto:maxim.ainsworth@gmail.com"
```

### 3. Deploy the two edge functions

```bash
supabase functions deploy notify-activity --no-verify-jwt
supabase functions deploy reminders --no-verify-jwt
```

### 4. Database side

Open the Supabase SQL Editor and run the whole of `setup-notifications.sql`
(tables, insert trigger, 10-minute cron job).

### 5. Push the app update

```bash
git add -A
git commit -m "feat: web push notifications"
git push
```

### 6. On each phone (from the HOME SCREEN app, not Safari)

Set-up → 🔔 **Enable notifications on this phone** → Allow.

## Testing

- Log a wee on one phone → the other phone gets "💧 Wee outside ✅" within seconds.
- Reminders fire on the 10-minute cron once he's been awake 50+ mins.
- Function logs: Supabase dashboard → Edge Functions → invocations.

## Notes & quirks

- iPhone: pushes only work for the installed Home Screen app (iOS 16.4+), and iOS may
  batch/delay them slightly in Low Power Mode. Delete + re-add the home screen app if
  the enable button says unsupported — an old cached version may lack the push handler.
- The device that logs an event never gets its own activity push.
- Bulk-imported written-log rows (seed ids) never trigger pushes.
- Tuning (awake window, wee nag interval, quiet hours) lives at the top of
  `supabase/functions/reminders/index.ts` — edit and redeploy that one function.
