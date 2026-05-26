const STORAGE_KEY = "vaultio-scout-leads";

export type LeadStatus = "new" | "contacted" | "replied" | "bounced";

export type Lead = {
  email: string;
  name?: string;
  role?: string;
  companyName?: string;
  domain?: string;
  source?: string;
  status: LeadStatus;
  createdAt: number;
  contactedAt?: number;
  lastSubject?: string;
};

function read(): Lead[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Lead[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(leads: Lead[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
    window.dispatchEvent(new CustomEvent("vaultio-leads-changed"));
  } catch {
    /* ignore */
  }
}

export function loadLeads(): Lead[] {
  return read().sort((a, b) => {
    // contacted/replied first by contactedAt, then new by createdAt
    const at = a.contactedAt ?? a.createdAt;
    const bt = b.contactedAt ?? b.createdAt;
    return bt - at;
  });
}

export function upsertLead(input: Omit<Lead, "status" | "createdAt"> & { status?: LeadStatus }) {
  const all = read();
  const email = input.email.toLowerCase().trim();
  if (!email) return;
  const idx = all.findIndex((l) => l.email === email);
  if (idx >= 0) {
    all[idx] = {
      ...all[idx],
      ...input,
      email,
      status: input.status ?? all[idx].status,
    };
  } else {
    all.push({
      ...input,
      email,
      status: input.status ?? "new",
      createdAt: Date.now(),
    });
  }
  write(all);
}

export function markContacted(email: string, subject?: string) {
  const all = read();
  const e = email.toLowerCase().trim();
  const idx = all.findIndex((l) => l.email === e);
  if (idx >= 0) {
    all[idx] = {
      ...all[idx],
      status: "contacted",
      contactedAt: Date.now(),
      lastSubject: subject ?? all[idx].lastSubject,
    };
  } else {
    all.push({
      email: e,
      status: "contacted",
      createdAt: Date.now(),
      contactedAt: Date.now(),
      lastSubject: subject,
    });
  }
  write(all);
}

export function deleteLead(email: string) {
  write(read().filter((l) => l.email !== email.toLowerCase().trim()));
}

export function useLeadsSubscription(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener("vaultio-leads-changed", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("vaultio-leads-changed", handler);
    window.removeEventListener("storage", handler);
  };
}
