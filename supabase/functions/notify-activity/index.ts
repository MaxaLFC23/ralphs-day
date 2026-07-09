// Sends a push to every subscribed device EXCEPT the one that logged the event.
// Invoked by a database trigger on insert into ralph_events.
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "mailto:ralph@example.invalid",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

function describe(p: any): string | null {
  switch (p.type) {
    case "wee": return p.where === "outside" ? "💧 Wee outside ✅" : "💧 Wee inside ❌";
    case "poo": return p.where === "outside" ? "💩 Poo outside ✅" : "💩 Poo inside ❌";
    case "napStart": return "😴 Nap started";
    case "napEnd": return "☀️ Ralph's awake";
    case "meal": return `🍚 Meal ${p.grams}g${p.finished === false ? " (left some)" : ""}`;
    case "flag": return ({ zoomies: "🌀 Zoomies / bitey", visitors: "🚪 Visitors", sling: "👜 Sling trip", training: "🎓 Training", play: "🧸 Play", crying: "😿 Crying" } as any)[p.flag] || null;
    default: return null;
  }
}

async function sendTo(sub: any, payload: string) {
  try {
    await webpush.sendNotification(sub.sub, payload);
  } catch (err: any) {
    // expired/unsubscribed endpoint — clean it up
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE", headers: H });
    }
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const rec = body.record;
  if (!rec) return new Response("no record", { status: 400 });
  const p = rec.payload || {};
  // skip bulk-imported written-log rows and deletions/edits
  if (String(rec.id).startsWith("seed") || p.deleted) return new Response("skip");
  const label = describe(p);
  if (!label) return new Response("skip");

  const subs = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,device,sub`, { headers: H }).then((r) => r.json());
  const payload = JSON.stringify({ title: "Ralph's Day", body: label, tag: "ralph-activity" });
  await Promise.allSettled(subs.filter((s: any) => s.device !== p.dev).map((s: any) => sendTo(s, payload)));
  return new Response("ok");
});
