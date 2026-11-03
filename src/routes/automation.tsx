import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Check,
  Clock3,
  Mail,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { ThreadSidebar } from "@/components/thread-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Settings = {
  enabled: boolean;
  search_query: string;
  daily_cycle_date: string | null;
  daily_cycle_count: number;
  last_cycle_at: string | null;
  last_error: string | null;
};

type Draft = {
  id: string;
  source_type: "initial" | "reply" | "follow_up";
  contact_id: string | null;
  company_name: string;
  recipient_name: string;
  recipient_email: string;
  subject: string;
  body: string;
  source_urls: string[];
  status: string;
  eligible: boolean;
  last_error: string | null;
  created_at: string;
};

type AutomationData = {
  settings: Settings;
  runs: Array<{
    id: string;
    status: string;
    companies_reviewed: number;
    drafts_created: number;
    summary: string | null;
    error: string | null;
    started_at: string;
  }>;
  drafts: Draft[];
  inbound: Array<{
    id: string;
    subject: string;
    sender_email: string;
    body: string;
    received_at: string;
    status: string;
  }>;
};

type LawfulBasis = "consent" | "legitimate_interest" | "contract" | "other";

export const Route = createFileRoute("/automation")({
  head: () => ({
    meta: [
      { title: "Automation - Startup Scout" },
      {
        name: "description",
        content: "Manage background scouting, inbound replies, and email approval drafts.",
      },
    ],
  }),
  component: AutomationPage,
});

function AutomationPage() {
  const [data, setData] = useState<AutomationData | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Record<string, { subject: string; body: string }>>({});
  const [basis, setBasis] = useState<Record<string, LawfulBasis>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/automation", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = (await response.json()) as AutomationData & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load automation status.");
      setData(result);
      setQuery(result.settings.search_query);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const post = async (
    key: string,
    action: Record<string, unknown>,
    successMessage: string | ((result: { status?: string }) => string),
  ) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/automation", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        status?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error ?? `Request failed${result.status ? `: ${result.status}` : ""}.`,
        );
      setNotice(typeof successMessage === "string" ? successMessage : successMessage(result));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = () =>
    post(
      "configure",
      { action: "configure", enabled: data?.settings.enabled ?? false, searchQuery: query },
      "Automation settings saved.",
    );

  const setEnabled = (enabled: boolean) =>
    post(
      "configure",
      { action: "configure", enabled, searchQuery: query },
      enabled ? "Background scouting enabled." : "Background scouting paused.",
    );

  const runNow = () =>
    post("run", { action: "run" }, (result) =>
      result.status === "completed"
        ? "Automation cycle completed; drafts are ready for review."
        : result.status === "daily_limit"
          ? "The three-cycle daily limit has been reached."
          : result.status === "locked"
            ? "An automation cycle is already running."
            : result.status === "disabled"
              ? "Enable automation before starting a cycle."
              : `Automation did not start (${result.status ?? "unknown status"}).`,
    );

  const saveDraft = (draft: Draft) => {
    const updated = editing[draft.id] ?? { subject: draft.subject, body: draft.body };
    return post(
      `edit:${draft.id}`,
      { action: "edit", draftId: draft.id, subject: updated.subject, body: updated.body },
      "Draft updated.",
    );
  };

  const markContactEligible = (draft: Draft) =>
    post(
      `review:${draft.id}`,
      {
        action: "review-contact",
        contactId: draft.contact_id,
        lawfulBasis: basis[draft.id],
      },
      "Contact eligibility reviewed. Approve the message separately to send.",
    );

  return (
    <div className="flex h-screen min-h-[560px] w-screen overflow-hidden bg-muted/30">
      <div className="hidden md:block">
        <ThreadSidebar />
      </div>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Workspace / Agent</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Background automation</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Scout companies, research hiring signals, draft outreach, and prepare reply and
                follow-up drafts.
              </p>
            </div>
            <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          <div className="mt-6 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p>
              <strong>Nothing is sent in the background.</strong> Every email needs
              contact-eligibility review when applicable, then its own explicit “Approve &amp; send”
              action. Automation runs at most three times per UTC day.
            </p>
          </div>

          {error ? (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}
          {notice ? (
            <div
              role="status"
              className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700"
            >
              {notice}
            </div>
          ) : null}

          {data ? (
            <>
              <section className="mt-6 rounded-2xl border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${data.settings.enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                    >
                      {data.settings.enabled ? (
                        <Activity className="h-5 w-5" />
                      ) : (
                        <Pause className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <h2 className="font-semibold">
                        {data.settings.enabled ? "Agent is active" : "Agent is paused"}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {data.settings.daily_cycle_date === new Date().toISOString().slice(0, 10)
                          ? data.settings.daily_cycle_count
                          : 0}{" "}
                        / 3 cycles used today (UTC)
                        {data.settings.last_cycle_at
                          ? ` · Last run ${new Date(data.settings.last_cycle_at).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => void saveSettings()}
                      disabled={busy !== null || query.trim().length < 5}
                    >
                      Save query
                    </Button>
                    {data.settings.enabled ? (
                      <Button
                        variant="outline"
                        onClick={() => void setEnabled(false)}
                        disabled={busy !== null}
                      >
                        <Pause className="mr-2 h-4 w-4" /> Pause
                      </Button>
                    ) : (
                      <Button
                        onClick={() => void setEnabled(true)}
                        disabled={busy !== null || query.trim().length < 5}
                      >
                        <Play className="mr-2 h-4 w-4" /> Enable
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => void runNow()}
                      disabled={busy !== null || !data.settings.enabled}
                    >
                      <Play className="mr-2 h-4 w-4" /> Run now
                    </Button>
                  </div>
                </div>
                <label className="mt-5 block text-sm font-medium" htmlFor="automation-query">
                  Discovery focus
                </label>
                <Input
                  id="automation-query"
                  className="mt-2"
                  value={query}
                  maxLength={240}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Seed-stage AI startups hiring remote engineers"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Each cycle reviews up to three companies. Paid Apollo and Firecrawl usage is
                  bounded by the daily cycle limit.
                </p>
                {data.settings.last_error ? (
                  <p className="mt-3 text-sm text-destructive">
                    Last cycle error: {data.settings.last_error}
                  </p>
                ) : null}
              </section>

              <section className="mt-8">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold">Approval outbox</h2>
                    <p className="text-sm text-muted-foreground">
                      Review, edit, and approve each email individually.
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    {data.drafts.filter((draft) => draft.status === "pending").length} awaiting
                    review
                  </span>
                </div>
                {data.drafts.length ? (
                  <div className="flex flex-col gap-4">
                    {data.drafts.map((draft) => {
                      const changes = editing[draft.id] ?? {
                        subject: draft.subject,
                        body: draft.body,
                      };
                      const changesSaved =
                        changes.subject === draft.subject && changes.body === draft.body;
                      return (
                        <article
                          key={draft.id}
                          className="rounded-2xl border bg-card p-5 shadow-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                                  {draft.source_type.replace("_", " ")}
                                </span>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${draft.status === "pending" ? "bg-amber-500/10 text-amber-700" : "bg-destructive/10 text-destructive"}`}
                                >
                                  {draft.status}
                                </span>
                              </div>
                              <h3 className="mt-3 font-semibold">
                                {draft.recipient_name}{" "}
                                <span className="font-normal text-muted-foreground">
                                  · {draft.company_name}
                                </span>
                              </h3>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {draft.recipient_email} · drafted{" "}
                                {new Date(draft.created_at).toLocaleString()}
                              </p>
                              {draft.source_urls.length ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {draft.source_urls.map((source) => (
                                    <a
                                      key={source}
                                      href={source}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs font-medium text-primary hover:underline"
                                    >
                                      Hiring source
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {draft.last_error ? (
                            <p className="mt-3 text-sm text-destructive">{draft.last_error}</p>
                          ) : null}
                          {draft.status === "sending" ? (
                            <p className="mt-3 rounded-md bg-amber-500/10 p-3 text-sm text-amber-800">
                              Send state is still being reconciled. Check Resend before taking
                              further action to avoid a duplicate.
                            </p>
                          ) : null}
                          {draft.status === "failed" ? (
                            <p className="mt-3 rounded-md bg-destructive/5 p-3 text-sm text-destructive">
                              This send will not retry automatically. Check Resend before creating
                              another draft.
                            </p>
                          ) : null}
                          <label
                            className="mt-4 block text-xs font-medium text-muted-foreground"
                            htmlFor={`subject-${draft.id}`}
                          >
                            Subject
                          </label>
                          <Input
                            id={`subject-${draft.id}`}
                            className="mt-1"
                            value={changes.subject}
                            disabled={draft.status !== "pending"}
                            onChange={(event) =>
                              setEditing((current) => ({
                                ...current,
                                [draft.id]: { ...changes, subject: event.target.value },
                              }))
                            }
                          />
                          <label
                            className="mt-3 block text-xs font-medium text-muted-foreground"
                            htmlFor={`body-${draft.id}`}
                          >
                            Message
                          </label>
                          <textarea
                            id={`body-${draft.id}`}
                            className="mt-1 min-h-40 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={changes.body}
                            disabled={draft.status !== "pending"}
                            onChange={(event) =>
                              setEditing((current) => ({
                                ...current,
                                [draft.id]: { ...changes, body: event.target.value },
                              }))
                            }
                          />
                          {draft.status === "pending" ? (
                            <>
                              {!draft.eligible && draft.contact_id ? (
                                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                                  <p className="text-sm font-medium">
                                    Contact eligibility review required
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Confirm a lawful basis before this contact can be sent email.
                                    This does not send the draft.
                                  </p>
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <select
                                      aria-label={`Lawful basis for ${draft.recipient_name}`}
                                      value={basis[draft.id] ?? ""}
                                      onChange={(event) =>
                                        setBasis((current) => ({
                                          ...current,
                                          [draft.id]: event.target.value as LawfulBasis,
                                        }))
                                      }
                                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                    >
                                      <option value="" disabled>
                                        Select the lawful basis
                                      </option>
                                      <option value="legitimate_interest">
                                        Legitimate interest
                                      </option>
                                      <option value="consent">Consent</option>
                                      <option value="contract">Contract</option>
                                      <option value="other">Other</option>
                                    </select>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => void markContactEligible(draft)}
                                      disabled={busy !== null || !basis[draft.id]}
                                    >
                                      Review contact eligibility
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                              {!draft.eligible && !draft.contact_id ? (
                                <p className="mt-4 text-sm text-destructive">
                                  This draft has no linked contact record and cannot be sent.
                                </p>
                              ) : null}
                              <div className="mt-4 flex flex-wrap justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void saveDraft(draft)}
                                  disabled={
                                    busy !== null || !changes.subject.trim() || !changes.body.trim()
                                  }
                                >
                                  Save edits
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    void post(
                                      `reject:${draft.id}`,
                                      { action: "reject", draftId: draft.id },
                                      "Draft rejected.",
                                    )
                                  }
                                  disabled={busy !== null}
                                >
                                  <X className="mr-1.5 h-4 w-4" /> Reject
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    void post(
                                      `approve:${draft.id}`,
                                      { action: "approve", draftId: draft.id },
                                      "Email sent.",
                                    )
                                  }
                                  disabled={busy !== null || !draft.eligible || !changesSaved}
                                >
                                  <Check className="mr-1.5 h-4 w-4" /> Approve &amp; send
                                </Button>
                              </div>
                            </>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No drafts need review yet.
                  </div>
                )}
              </section>

              <div className="mt-8 grid gap-8 lg:grid-cols-2">
                <section>
                  <h2 className="mb-3 text-xl font-semibold">Recent cycles</h2>
                  <div className="divide-y rounded-2xl border bg-card">
                    {data.runs.length ? (
                      data.runs.map((run) => (
                        <div key={run.id} className="flex gap-3 p-4">
                          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {run.summary ?? run.error ?? run.status}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(run.started_at).toLocaleString()} · {run.status}
                            </p>
                            {run.error ? (
                              <p className="mt-2 text-xs text-destructive">{run.error}</p>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="p-5 text-sm text-muted-foreground">
                        No background cycles have run yet.
                      </p>
                    )}
                  </div>
                </section>
                <section>
                  <h2 className="mb-3 text-xl font-semibold">Inbound replies</h2>
                  <div className="divide-y rounded-2xl border bg-card">
                    {data.inbound.length ? (
                      data.inbound.map((message) => (
                        <div key={message.id} className="p-4">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Mail className="h-4 w-4 text-muted-foreground" />{" "}
                            {message.subject || "(no subject)"}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {message.sender_email} ·{" "}
                            {new Date(message.received_at).toLocaleString()} · {message.status}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                            {message.body}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="p-5 text-sm text-muted-foreground">
                        Replies arrive here after Resend receiving is configured.
                      </p>
                    )}
                  </div>
                </section>
              </div>
              <div className="mt-6 text-right">
                <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Refresh status
                </Button>
              </div>
            </>
          ) : loading ? (
            <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" /> Loading agent status…
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
