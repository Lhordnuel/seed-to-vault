/**
 * Resend webhook receiver + in-memory event store.
 *
 * NOTE: In-memory store resets on cold start. For production-grade durability,
 * persist to a database. This is intentional to avoid adding Cloud just for
 * delivery tracking; it gives Nuel real-time visibility while the worker is warm.
 *
 * Configure in Resend dashboard → Webhooks:
 *   URL: https://<your-domain>/api/public/resend-webhook
 *   Events: email.sent, email.delivered, email.opened, email.clicked,
 *           email.bounced, email.complained, email.delivery_delayed
 */

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

export function recordEvent(ev: EmailEvent) {
  events.push(ev);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
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

export function summarize(): EmailStatus[] {
  const groups = new Map<string, EmailEvent[]>();
  for (const e of events) {
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
