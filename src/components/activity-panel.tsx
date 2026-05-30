import type { UIMessage } from "ai";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  Search,
  XCircle,
  Globe,
  Users,
  Copy,
  Trash2,
  Upload,
} from "lucide-react";
import {
  loadLeads,
  upsertLead,
  markContacted,
  deleteLead,
  useLeadsSubscription,
  type Lead,
} from "@/lib/leads";
import {
  loadSentEmails,
  recordSentEmails,
  subscribeSentEmails,
  type SentEmail,
} from "@/lib/sent-emails";

type ToolPart = {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: any;
  output?: any;
  errorText?: string;
};

type ActivityItem = {
  id: string;
  tool: string;
  state: string;
  input?: any;
  output?: any;
  errorText?: string;
};

type LeadHit = {
  title?: string;
  url?: string;
  snippet?: string;
  source: string;
};

type Pitch = {
  companyName: string;
  whatTheyDo?: string;
  hiringRoles?: string[];
  stage?: string;
  size?: string;
  angle?: string;
};

function extractActivity(messages: UIMessage[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  messages.forEach((m) => {
    m.parts.forEach((p: any, i) => {
      if (typeof p?.type === "string" && p.type.startsWith("tool-")) {
        items.push({
          id: p.toolCallId ?? `${m.id}-${i}`,
          tool: p.type.replace(/^tool-/, ""),
          state: p.state ?? "input-available",
          input: p.input,
          output: p.output,
          errorText: p.errorText,
        });
      }
    });
  });
  return items;
}

function extractLeadHits(items: ActivityItem[]): LeadHit[] {
  const seen = new Set<string>();
  const leads: LeadHit[] = [];
  items.forEach((a) => {
    if (a.tool !== "search_startups" || !a.output) return;
    const src = a.output.source ?? a.input?.source ?? "web";
    const results = a.output.results ?? [];
    results.forEach((r: any) => {
      const url = r?.url;
      if (!url || seen.has(url)) return;
      seen.add(url);
      leads.push({ title: r.title, url, snippet: r.snippet, source: src });
    });
  });
  return leads;
}

function extractPitches(items: ActivityItem[]): Pitch[] {
  return items
    .filter((a) => a.tool === "draft_pitch" && a.input)
    .map((a) => a.input as Pitch);
}

// Persist contacts discovered from find_executive_contacts and send_pitch
function syncLeadsFromActivity(items: ActivityItem[]) {
  items.forEach((a) => {
    if (a.tool === "find_executive_contacts" && a.output?.contacts) {
      const companyName: string | undefined =
        a.output.companyName ?? a.input?.companyName;
      const domain: string | undefined = a.output.domain;
      (a.output.contacts as any[]).forEach((c) => {
        if (!c?.email) return;
        upsertLead({
          email: c.email,
          name: c.name,
          role: c.role,
          source: c.source,
          companyName,
          domain,
        });
      });
    }
    if (a.tool === "send_pitch" && a.output?.sent && a.input?.to) {
      markContacted(a.input.to as string, a.input.subject as string | undefined);
      if (a.output.resendId) {
        recordSentEmails([
          {
            resendId: a.output.resendId,
            to: a.input.to,
            subject: a.input.subject,
            companyName: a.input.companyName ?? a.output.companyName,
            sentAt: Date.now(),
          },
        ]);
      }
    }
    if (a.tool === "bulk_send_pitch" && Array.isArray(a.output?.sent)) {
      const batch: SentEmail[] = [];
      (a.output.sent as any[]).forEach((s) => {
        if (s?.to) markContacted(s.to as string, s.subject as string | undefined);
        if (s?.resendId && s?.to) {
          batch.push({
            resendId: s.resendId,
            to: s.to,
            subject: s.subject,
            companyName: s.companyName,
            sentAt: Date.now(),
          });
        }
      });
      recordSentEmails(batch);
    }
    if (a.tool === "apollo_find_contacts" && Array.isArray(a.output?.contacts)) {
      const companyName: string | undefined =
        a.output.companyName ?? a.input?.companyName;
      const domain: string | undefined = a.output.domain ?? a.input?.domain;
      (a.output.contacts as any[]).forEach((c) => {
        if (!c?.email) return;
        upsertLead({
          email: c.email,
          name: c.name,
          role: c.title,
          companyName,
          domain,
          source: c.linkedin,
        });
      });
    }
  });
}

function StateIcon({ state }: { state: string }) {
  if (state === "output-available")
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (state === "output-error")
    return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
}

function ToolIcon({ tool }: { tool: string }) {
  if (tool === "search_startups") return <Search className="h-3.5 w-3.5" />;
  if (tool === "scrape_company") return <Globe className="h-3.5 w-3.5" />;
  if (tool === "find_executive_contacts")
    return <Users className="h-3.5 w-3.5" />;
  if (tool === "draft_pitch") return <Mail className="h-3.5 w-3.5" />;
  if (tool === "send_pitch") return <Mail className="h-3.5 w-3.5" />;
  if (tool === "bulk_send_pitch") return <Mail className="h-3.5 w-3.5" />;
  return <Activity className="h-3.5 w-3.5" />;
}

function toolLabel(tool: string, input: any) {
  if (tool === "search_startups")
    return `Searching ${input?.source ?? ""} — "${input?.query ?? ""}"`;
  if (tool === "scrape_company") return `Scraping ${input?.url ?? ""}`;
  if (tool === "find_executive_contacts")
    return `Finding execs at ${input?.companyName ?? input?.domain ?? ""}`;
  if (tool === "apollo_find_contacts")
    return `Apollo contacts for ${input?.companyName ?? input?.domain ?? ""}`;
  if (tool === "apollo_search_startups")
    return `Apollo search — "${input?.keywords ?? ""}"`;
  if (tool === "draft_pitch")
    return `Drafting pitch for ${input?.companyName ?? ""}`;
  if (tool === "send_pitch")
    return `Sending to ${input?.to ?? ""}`;
  if (tool === "bulk_send_pitch")
    return `Bulk sending to ${input?.recipients?.length ?? 0} recipients`;
  return tool;
}

type Tab = "activity" | "contacts" | "delivery";

type DeliveryEvent = {
  email: string;
  subject?: string;
  resendId?: string;
  latest: string;
  latestAt: number;
  history: { type: string; at: number; bounceReason?: string }[];
};

function useDeliveryEvents(active: boolean) {
  const [events, setEvents] = useState<DeliveryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const fetchOnce = async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/email-events");
        if (!r.ok) return;
        const data = (await r.json()) as { events: DeliveryEvent[] };
        if (!cancelled) setEvents(data.events ?? []);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);
  return { events, loading };
}

export function ActivityPanel({
  messages,
  isRunning,
}: {
  messages: UIMessage[];
  isRunning: boolean;
}) {
  const activity = useMemo(() => extractActivity(messages), [messages]);
  const hits = useMemo(() => extractLeadHits(activity), [activity]);
  const pitches = useMemo(() => extractPitches(activity), [activity]);

  // Persist discovered emails as leads whenever activity changes
  useEffect(() => {
    syncLeadsFromActivity(activity);
  }, [activity]);

  const [leads, setLeads] = useState<Lead[]>(() => loadLeads());
  useEffect(() => {
    const refresh = () => setLeads(loadLeads());
    refresh();
    return useLeadsSubscription(refresh);
  }, []);

  const [tab, setTab] = useState<Tab>("activity");
  const contactedCount = leads.filter((l) => l.status === "contacted").length;

  return (
    <div className="flex h-full flex-col bg-muted/10">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4" />
          Bot activity
          {isRunning ? (
            <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Running
            </span>
          ) : (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              Idle
            </span>
          )}
        </div>
        <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
          <span>{activity.length} steps</span>
          <span>{hits.length} hits</span>
          <span>{leads.length} leads</span>
          <span>{contactedCount} contacted</span>
        </div>
        <div className="mt-3 flex gap-1 rounded-md bg-muted p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setTab("activity")}
            className={`flex-1 rounded px-2 py-1 transition ${
              tab === "activity"
                ? "bg-background shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Activity
          </button>
          <button
            type="button"
            onClick={() => setTab("contacts")}
            className={`flex-1 rounded px-2 py-1 transition ${
              tab === "contacts"
                ? "bg-background shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Contacts ({leads.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("delivery")}
            className={`flex-1 rounded px-2 py-1 transition ${
              tab === "delivery"
                ? "bg-background shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Delivery
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "contacts" ? (
          <ContactsSheet leads={leads} />
        ) : tab === "delivery" ? (
          <DeliverySheet />
        ) : (
          <>
            <Section
              title={`Hits (${hits.length})`}
              icon={<Building2 className="h-3.5 w-3.5" />}
            >
              {hits.length === 0 ? (
                <Empty text="No leads yet. Ask the bot to search." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {hits.map((l) => (
                    <li
                      key={l.url}
                      className="rounded-md border bg-background p-2.5 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium leading-tight line-clamp-2">
                          {l.title || l.url}
                        </div>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label="Open"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {l.source}
                        </span>
                      </div>
                      {l.snippet ? (
                        <p className="mt-1.5 line-clamp-2 text-muted-foreground">
                          {l.snippet}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title={`Pitches (${pitches.length})`}
              icon={<Mail className="h-3.5 w-3.5" />}
            >
              {pitches.length === 0 ? (
                <Empty text="No pitches drafted yet." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {pitches.map((p, i) => (
                    <li
                      key={`${p.companyName}-${i}`}
                      className="rounded-md border bg-background p-2.5 text-xs"
                    >
                      <div className="font-medium">{p.companyName}</div>
                      {p.stage || p.size ? (
                        <div className="mt-0.5 text-muted-foreground">
                          {[p.stage, p.size].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                      {p.hiringRoles?.length ? (
                        <div className="mt-1 text-muted-foreground">
                          Hiring: {p.hiringRoles.join(", ")}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title={`Activity log (${activity.length})`}
              icon={<Activity className="h-3.5 w-3.5" />}
            >
              {activity.length === 0 ? (
                <Empty text="The bot hasn't run any tools yet." />
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {activity.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-start gap-2 rounded-md border bg-background px-2.5 py-2 text-[11px]"
                    >
                      <div className="mt-0.5 text-muted-foreground">
                        <ToolIcon tool={a.tool} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {toolLabel(a.tool, a.input)}
                        </div>
                        {a.errorText ? (
                          <div className="text-destructive">{a.errorText}</div>
                        ) : a.tool === "search_startups" &&
                          a.output?.count != null ? (
                          <div className="text-muted-foreground">
                            {a.output.count} result
                            {a.output.count === 1 ? "" : "s"}
                          </div>
                        ) : a.tool === "find_executive_contacts" &&
                          a.output?.contacts ? (
                          <div className="text-muted-foreground">
                            {a.output.contacts.length} email
                            {a.output.contacts.length === 1 ? "" : "s"} found
                          </div>
                        ) : a.tool === "send_pitch" && a.output?.sent ? (
                          <div className="text-emerald-600">
                            sent to {a.output.to}
                          </div>
                        ) : null}
                      </div>
                      <StateIcon state={a.state} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function ContactsSheet({ leads }: { leads: Lead[] }) {
  return (
    <div>
      <ImportLeads />
      {leads.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">
          No contacts yet. Import a CSV/list above, or let the bot extract
          emails automatically.
        </div>
      ) : (
        <div className="divide-y">
          <div className="sticky top-0 grid grid-cols-[1fr_auto] items-center gap-2 bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
            <span>Name / Email / Company</span>
            <span>Status</span>
          </div>
          {leads.map((l) => (
            <ContactRow key={l.email} lead={l} />
          ))}
        </div>
      )}
    </div>
  );
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const splitRow = (row: string) => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '"') {
        if (inQ && row[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (c === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const hasEmailHeader = header.some((h) => /email/.test(h));
  if (!hasEmailHeader) {
    // Treat as plain list — extract emails per line
    return lines.flatMap((l) => {
      const matches = l.match(EMAIL_RE) ?? [];
      return matches.map((m) => ({ email: m }));
    });
  }
  return lines.slice(1).map((row) => {
    const cells = splitRow(row);
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      rec[h] = cells[i] ?? "";
    });
    return rec;
  });
}

function pickField(r: Record<string, string>, keys: string[]) {
  for (const k of keys) {
    const v = r[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function ImportLeads() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const doImport = (raw: string) => {
    const rows = parseCsv(raw);
    let added = 0;
    rows.forEach((r) => {
      const email = pickField(r, ["email", "email_address", "e-mail"]);
      if (!email || !EMAIL_RE.test(email)) return;
      upsertLead({
        email,
        name: pickField(r, ["name", "full_name", "first_name", "contact"]),
        role: pickField(r, ["role", "title", "position", "job_title"]),
        companyName: pickField(r, ["company", "company_name", "organization", "org"]),
        domain: pickField(r, ["domain", "website", "url"]),
        source: pickField(r, ["source"]) ?? "import",
      });
      added++;
    });
    setMsg(added > 0 ? `Imported ${added} contact${added === 1 ? "" : "s"}` : "No valid emails found");
    if (added > 0) {
      setText("");
      setTimeout(() => setOpen(false), 800);
    }
  };

  const onFile = async (f: File) => {
    const raw = await f.text();
    doImport(raw);
  };

  return (
    <div className="border-b bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <Upload className="h-3.5 w-3.5" />
          Import CSV / list
        </button>
        <label className="cursor-pointer rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
          Choose file
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={`Paste CSV with headers (email,name,company,role,domain)\nor one email per line`}
            className="w-full rounded-md border bg-background p-2 text-xs font-mono"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              Headers recognized: email, name, company, role/title, domain
            </span>
            <button
              type="button"
              onClick={() => doImport(text)}
              disabled={!text.trim()}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Import
            </button>
          </div>
        </div>
      ) : null}
      {msg ? (
        <div className="mt-1.5 text-[11px] text-muted-foreground">{msg}</div>
      ) : null}
    </div>
  );
}

function ContactRow({ lead }: { lead: Lead }) {
  const status = lead.status;
  const badge =
    status === "contacted"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : status === "replied"
        ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
        : status === "bounced"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-2 px-3 py-2.5 text-xs">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">
            {lead.name || lead.email.split("@")[0]}
          </span>
          {lead.role ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {lead.role}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-muted-foreground">
          <a
            href={`mailto:${lead.email}`}
            className="truncate hover:text-foreground hover:underline"
          >
            {lead.email}
          </a>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(lead.email)}
            className="shrink-0 opacity-60 hover:opacity-100"
            aria-label="Copy email"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
        {lead.companyName || lead.domain ? (
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {lead.companyName || lead.domain}
          </div>
        ) : null}
        {lead.contactedAt ? (
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            contacted {new Date(lead.contactedAt).toLocaleDateString()}
            {lead.lastSubject ? ` · "${lead.lastSubject}"` : ""}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge}`}
        >
          {status}
        </span>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Remove ${lead.email}?`)) deleteLead(lead.email);
          }}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Delete lead"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b px-3 py-3">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="px-1 py-2 text-[11px] text-muted-foreground">{text}</div>
  );
}

function statusBadge(t: string) {
  if (t === "email.bounced" || t === "email.complained")
    return "bg-destructive/15 text-destructive";
  if (t === "email.opened" || t === "email.clicked")
    return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
  if (t === "email.delivered")
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  return "bg-muted text-muted-foreground";
}

type ResendStatus = {
  id: string;
  to?: string;
  subject?: string;
  last_event?: string;
  created_at?: string;
  error?: string;
};

function useResendStatuses(sent: SentEmail[]) {
  const [statuses, setStatuses] = useState<Record<string, ResendStatus>>({});
  const [loading, setLoading] = useState(false);
  const ids = useMemo(() => sent.map((s) => s.resendId).filter(Boolean), [sent]);
  const key = ids.join(",");
  useEffect(() => {
    if (!ids.length) {
      setStatuses({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/email-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!r.ok) return;
        const data = (await r.json()) as { statuses: ResendStatus[] };
        if (cancelled) return;
        const map: Record<string, ResendStatus> = {};
        (data.statuses ?? []).forEach((s) => {
          map[s.id] = s;
        });
        setStatuses(map);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    const id = setInterval(run, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { statuses, loading };
}

function DeliverySheet() {
  const { events } = useDeliveryEvents(true);
  const [sent, setSent] = useState<SentEmail[]>(() => loadSentEmails());
  useEffect(() => {
    const refresh = () => setSent(loadSentEmails());
    refresh();
    return subscribeSentEmails(refresh);
  }, []);
  const { statuses, loading } = useResendStatuses(sent);

  // Webhook events keyed by resendId for quick lookup
  const webhookById = useMemo(() => {
    const m = new Map<string, DeliveryEvent>();
    events.forEach((e) => {
      if (e.resendId) m.set(e.resendId, e);
    });
    return m;
  }, [events]);

  return (
    <div>
      <div className="border-b bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground">
        Status polled from Resend every 15s. Webhook events
        (<code className="rounded bg-muted px-1">/api/public/resend-webhook</code>)
        layer in real-time opens/bounces when configured.
      </div>
      {sent.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">
          {loading
            ? "Loading…"
            : "No sent emails tracked yet. Send a pitch and it will appear here with delivery status."}
        </div>
      ) : (
        <div className="divide-y">
          {sent.map((s) => {
            const wh = webhookById.get(s.resendId);
            const st = statuses[s.resendId];
            const latest =
              wh?.latest ??
              (st?.last_event ? `email.${st.last_event}` : "email.sent");
            return (
              <div key={s.resendId} className="px-3 py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{s.to}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusBadge(
                      latest,
                    )}`}
                  >
                    {latest.replace(/^email\./, "")}
                  </span>
                </div>
                {s.subject ? (
                  <div className="mt-0.5 truncate text-muted-foreground">
                    {s.subject}
                  </div>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    sent · {new Date(s.sentAt).toLocaleTimeString()}
                  </span>
                  {wh?.history?.map((h, j) => (
                    <span key={j} className="rounded bg-muted px-1.5 py-0.5">
                      {h.type.replace(/^email\./, "")} ·{" "}
                      {new Date(h.at).toLocaleTimeString()}
                    </span>
                  ))}
                  {st?.error ? (
                    <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                      resend: {st.error}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
