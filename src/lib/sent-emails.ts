// Tracks emails sent via send_pitch / bulk_send_pitch.
// Persisted in localStorage so we can poll Resend for status even after
// the Worker isolate cycles (the in-memory webhook store does not survive cold starts).

const KEY = "scout.sentEmails.v1";

export type SentEmail = {
  resendId: string;
  to: string;
  subject?: string;
  companyName?: string;
  sentAt: number;
};

function read(): SentEmail[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SentEmail[]) : [];
  } catch {
    return [];
  }
}

function write(items: SentEmail[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(-500)));
    window.dispatchEvent(new Event("scout:sent-emails"));
  } catch {
    /* quota */
  }
}

export function loadSentEmails(): SentEmail[] {
  return read().sort((a, b) => b.sentAt - a.sentAt);
}

export function recordSentEmail(s: SentEmail) {
  const all = read();
  if (all.some((e) => e.resendId === s.resendId)) return;
  all.push(s);
  write(all);
}

export function recordSentEmails(items: SentEmail[]) {
  if (!items.length) return;
  const all = read();
  const ids = new Set(all.map((e) => e.resendId));
  let changed = false;
  for (const s of items) {
    if (!s.resendId || ids.has(s.resendId)) continue;
    all.push(s);
    ids.add(s.resendId);
    changed = true;
  }
  if (changed) write(all);
}

export function subscribeSentEmails(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("scout:sent-emails", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("scout:sent-emails", cb);
    window.removeEventListener("storage", cb);
  };
}
