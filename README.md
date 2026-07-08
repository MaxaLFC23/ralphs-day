# Ralph's Day 🐾

Puppy toilet / nap / food tracker. Single static page, no build step, installable as a PWA.
Data lives in localStorage per phone; optional Supabase sync shares one log between phones.

## Deploy to GitHub Pages (personal account — MaxaLFC23)

From this folder:

```bash
git init
git add .
git commit -m "feat: ralphs day puppy tracker"
gh repo create MaxaLFC23/ralphs-day --public --source . --push
gh api repos/MaxaLFC23/ralphs-day/pages -X POST -f build_type=workflow 2>/dev/null \
  || echo "Enable Pages in repo Settings → Pages → Deploy from branch → main → / (root)"
```

Simplest reliable route if the API call moans: repo **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.

A minute later the app is live at:

```
https://MaxaLFC23.github.io/ralphs-day/
```

> Repo is public (GitHub Pages on a free personal account requires it). The page itself
> contains no data — Ralph's log lives on each phone / in your Supabase project, never in the repo.

## Install on phones (both of you)

1. Open the URL above in **Safari** (iPhone) or Chrome (Android)
2. Share → **Add to Home Screen**
3. Proper "Ralph" name + paw icon, full-screen, works offline

## Shared log between two phones (optional, ~5 mins)

Without this, each phone keeps its own log. To share one:

1. Create a free project at https://supabase.com (personal email)
2. SQL Editor → run:

```sql
create table ralph_events (
  id text primary key,
  mod bigint,
  payload jsonb
);
alter table ralph_events enable row level security;
create policy "anon all" on ralph_events for all using (true) with check (true);
```

3. Project Settings → API: copy the **Project URL** and **anon public key**
4. In the app: **Set-up → Shared sync** → paste both → Save & sync now — on **both phones**

First phone to sync uploads its history; the second merges in. Newest edit wins per entry.
(The anon-key + open-policy setup means anyone with the key could read/write the table —
fine for puppy wees, don't reuse the pattern for anything sensitive.)

## Notes

- First four days (5–8 July 2026) are pre-seeded from the written log. Day 1 toilet
  times are estimates; days 2–4 use actual logged times.
- "Re-import first four days" in Set-up restores the seed if ever wiped.
- CSV export in Set-up downloads the full event history.
- Update the app by editing `index.html` and pushing — the service worker picks up
  new versions on next open (network-first).
