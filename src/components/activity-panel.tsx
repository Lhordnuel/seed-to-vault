import type { UIMessage } from "ai";
import { useMemo } from "react";
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
} from "lucide-react";

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

type Lead = {
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

function extractLeads(items: ActivityItem[]): Lead[] {
  const seen = new Set<string>();
  const leads: Lead[] = [];
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
  if (tool === "draft_pitch") return <Mail className="h-3.5 w-3.5" />;
  return <Activity className="h-3.5 w-3.5" />;
}

function toolLabel(tool: string, input: any) {
  if (tool === "search_startups")
    return `Searching ${input?.source ?? ""} — "${input?.query ?? ""}"`;
  if (tool === "scrape_company") return `Scraping ${input?.url ?? ""}`;
  if (tool === "draft_pitch") return `Drafting pitch for ${input?.companyName ?? ""}`;
  return tool;
}

export function ActivityPanel({
  messages,
  isRunning,
}: {
  messages: UIMessage[];
  isRunning: boolean;
}) {
  const activity = useMemo(() => extractActivity(messages), [messages]);
  const leads = useMemo(() => extractLeads(activity), [activity]);
  const pitches = useMemo(() => extractPitches(activity), [activity]);

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
          <span>{leads.length} leads</span>
          <span>{pitches.length} pitches</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title={`Leads (${leads.length})`} icon={<Building2 className="h-3.5 w-3.5" />}>
          {leads.length === 0 ? (
            <Empty text="No leads yet. Ask the bot to search." />
          ) : (
            <ul className="flex flex-col gap-2">
              {leads.map((l) => (
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
                    ) : a.tool === "search_startups" && a.output?.count != null ? (
                      <div className="text-muted-foreground">
                        {a.output.count} result{a.output.count === 1 ? "" : "s"}
                      </div>
                    ) : null}
                  </div>
                  <StateIcon state={a.state} />
                </li>
              ))}
            </ul>
          )}
        </Section>
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
