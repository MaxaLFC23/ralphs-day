// Runs on a schedule (pg_cron, every 10 min). Reads ralph_events, works out whether
// a nap or wee is due, and pushes a reminder to ALL subscribed devices.
// Dedupes so each due-state notifies once, and stays silent during quiet hours.
import webpush from "npm:web-push@3.6.7";

// ---- tuning (mirrors app defaults; tweak here and redeploy) ----
const AWAKE_WINDOW_MIN = 50;   // nap due after this long awake
const WEE_WARN_MIN = 90;       // wee reminder after this long without one (while awake)
const WEE_REPEAT_MIN = 60;     // don't re-nag about wees more often than this
const QUIET_START = 21.5;      // 21:30 — no reminders overnight
const QUIET_END = 6.5;         // 06:30
const TZ = "Europe/London";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "mailto:ralph@example.invalid",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };

function ukHour(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h + m / 60;
}

async function getState(): Promise<any> {
  const rows = await fetch(`${SUPABASE_URL}/rest/v1/push_state?key=eq.reminders&select=value`, { headers: H }).then((r) => r.json());
  return rows[0]?.value || {};
}
async function setState(value: any) {
  await fetch(`${SUPABASE_URL}/rest/v1/push_state`, { method: "POST", headers: H, body: JSON.stringify([{ key: "reminders", value }]) });
}

async function broadcast(body: string, tag: string) {
  const subs = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,sub`, { headers: H }).then((r) => r.json());
  const payload = JSON.stringify({ title: "Ralph's Day", body, tag });
  await Promise.allSettled(subs.map(async (s: any) => {
    try { await webpush.sendNotification(s.sub, payload); }
    catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", headers: H });
      }
    }
  }));
}

Deno.serve(async (_req) => {
  const hour = ukHour();

  // ---- weekly digest: Sunday 19:00–19:59 UK, once per week ----
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(new Date());
  if (weekday === "Sun" && hour >= 19 && hour < 20) {
    const state0 = await getState();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    if (state0.lastDigest !== today) {
      const rows0 = await fetch(`${SUPABASE_URL}/rest/v1/ralph_events?select=payload&limit=5000`, { headers: H }).then((r) => r.json());
      const evs = rows0.map((r: any) => r.payload).filter((p: any) => p && !p.deleted).sort((a: any, b: any) => a.ts - b.ts);
      const now = Date.now();
      const wk = (n: number) => evs.filter((e: any) => e.ts > now - n * 7 * 86400000 && e.ts <= now - (n - 1) * 7 * 86400000);
      const thisWk = wk(1), lastWk = wk(2);
      const accidents = (list: any[]) => list.filter((e) => (e.type === "wee" || e.type === "poo") && e.where === "inside").length;
      const wees = thisWk.filter((e: any) => e.type === "wee");
      const outPct = wees.length ? Math.round((wees.filter((e: any) => e.where === "outside").length / wees.length) * 100) : null;
      // avg sleep/day this week
      let sleepMs = 0, open: number | null = null;
      thisWk.forEach((e: any) => {
        if (e.type === "napStart" && open === null) open = e.ts;
        if (e.type === "napEnd" && open !== null) { sleepMs += e.ts - open; open = null; }
      });
      const sleepH = (sleepMs / 7 / 3600000).toFixed(1);
      const a1 = accidents(thisWk), a0 = accidents(lastWk);
      const trend = a1 < a0 ? `⬇️ down from ${a0}` : a1 > a0 ? `⬆️ up from ${a0}` : `same as last week`;
      await broadcast(`📊 Ralph's week: ${a1} accidents (${trend})${outPct !== null ? `, ${outPct}% of wees outside` : ""}, ~${sleepH}h logged sleep/day. Good lad. 🐾`, "ralph-digest");
      state0.lastDigest = today;
      await setState(state0);
    }
  }

  const quiet = QUIET_START > QUIET_END ? (hour >= QUIET_START || hour < QUIET_END) : (hour >= QUIET_START && hour < QUIET_END);
  if (quiet) return new Response("quiet hours");

  const rows = await fetch(`${SUPABASE_URL}/rest/v1/ralph_events?select=payload&order=mod.desc&limit=2000`, { headers: H }).then((r) => r.json());
  const events = rows.map((r: any) => r.payload).filter((p: any) => p && !p.deleted).sort((a: any, b: any) => a.ts - b.ts);

  const lastOf = (t: string) => { for (let i = events.length - 1; i >= 0; i--) if (events[i].type === t) return events[i]; return null; };
  const lastNapStart = lastOf("napStart");
  const lastNapEnd = lastOf("napEnd");
  const asleep = !!(lastNapStart && (!lastNapEnd || lastNapStart.ts > lastNapEnd.ts));
  if (asleep || !lastNapEnd) return new Response("asleep — no reminders");

  const now = Date.now();
  const state = await getState();
  const sent: string[] = [];

  // nap due — once per wake (keyed on the napEnd id)
  const awakeMin = (now - lastNapEnd.ts) / 60000;
  if (awakeMin >= AWAKE_WINDOW_MIN && state.napNotifiedFor !== lastNapEnd.id) {
    await broadcast(`😴 Nap due — Ralph's been awake ${Math.round(awakeMin)} mins`, "ralph-nap");
    state.napNotifiedFor = lastNapEnd.id;
    sent.push("nap");
  }

  // wee due — while awake, repeat at most every WEE_REPEAT_MIN
  const lastWee = lastOf("wee");
  const weeAgoMin = lastWee ? (now - lastWee.ts) / 60000 : Infinity;
  const lastWeeNag = state.lastWeeNag || 0;
  if (weeAgoMin >= WEE_WARN_MIN && (now - lastWeeNag) / 60000 >= WEE_REPEAT_MIN) {
    await broadcast(`💧 No wee logged for ${Math.round(weeAgoMin)} mins — worth a garden trip?`, "ralph-wee");
    state.lastWeeNag = now;
    sent.push("wee");
  }

  if (sent.length) await setState(state);
  return new Response(sent.length ? "sent: " + sent.join(",") : "nothing due");
});
