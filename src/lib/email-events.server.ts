/**
 * Resend webhook receiver + delivery event store.
 *
 * Configure in Resend dashboard → Webhooks:
 *   URL: https://<your-domain>/api/public/resend-webhook
 *   Events: email.sent, email.delivered, email.opened, email.clicked,
 *           email.bounced, email.complained, email.delivery_delayed
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ResendEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.opened"
  | "email.clicked"
  | "email.bounced"
  | "email.complained";

export type EmailEvent = {
  type: ResendEventType | string;
  email: string;
  subject?: string;
  resendId?: string;
  at: number; // unix ms
  bounceReason?: string;
};

// Module-scoped ring buffer (warm-instance only).
const MAX_EVENTS = 500;
const events: EmailEvent[] = [];

export async function recordEvent(ev: EmailEvent) {
  events.push(ev);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  const db = supabaseAdmin as any;
  const { error } = await db.from("email_delivery_events").insert({
    type: ev.type,
    email: ev.email,
    subject: ev.subject,
    resend_id: ev.resendId,
    event_at: new Date(ev.at).toISOString(),
    bounce_reason: ev.bounceReason,
    raw: ev,
  });
  if (error) console.warn("[email-events] failed to persist event", error.message);
}

export function listEvents(): EmailEvent[] {
  // newest first
  return [...events].reverse();
}

/**
 * Aggregate the latest status per (email + resendId|subject) for UI display.
 * Priority: bounced > complained > opened > clicked > delivered > delivery_delayed > sent.
 */
const STATUS_RANK: Record<string, number> = {
  "email.bounced": 7,
  "email.complained": 6,
  "email.clicked": 5,
  "email.opened": 4,
  "email.delivered": 3,
  "email.delivery_delayed": 2,
  "email.sent": 1,
};

export type EmailStatus = {
  email: string;
  subject?: string;
  resendId?: string;
  latest: string;
  latestAt: number;
  history: EmailEvent[];
};

export async function summarize(): Promise<EmailStatus[]> {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("email_delivery_events")
    .select("type,email,subject,resend_id,event_at,bounce_reason")
    .order("event_at", { ascending: false })
    .limit(500);

  const source: EmailEvent[] = error
    ? events
    : (data ?? []).map((row: any) => ({
        type: row.type,
        email: row.email,
        subject: row.subject,
        resendId: row.resend_id,
        at: row.event_at ? Date.parse(row.event_at) : Date.now(),
        bounceReason: row.bounce_reason,
      }));

  const groups = new Map<string, EmailEvent[]>();
  for (const e of source) {
    const key = `${e.email.toLowerCase()}::${e.resendId ?? e.subject ?? ""}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  const out: EmailStatus[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.at - b.at);
    let latest = arr[0];
    for (const e of arr) {
      if ((STATUS_RANK[e.type] ?? 0) >= (STATUS_RANK[latest.type] ?? 0)) {
        latest = e;
      }
    }
    out.push({
      email: latest.email,
      subject: latest.subject,
      resendId: latest.resendId,
      latest: latest.type,
      latestAt: latest.at,
      history: arr,
    });
  }
  return out.sort((a, b) => b.latestAt - a.latestAt);
}
