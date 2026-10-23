import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  Building2,
  ExternalLink,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  UsersRound,
} from "lucide-react";
import { upsertLead } from "@/lib/leads";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputFooter,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { ActivityPanel } from "@/components/activity-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { upsertThread, titleFromMessages, type Thread } from "@/lib/threads";
import { useIsMobile } from "@/hooks/use-mobile";
import logo from "@/assets/logo.png";

type WorkflowPhase = "discover" | "contacts" | "draft" | "send";

function initialWorkflowPhase(messages: UIMessage[]): WorkflowPhase {
  let phase: WorkflowPhase = "discover";
  for (const message of messages) {
    if (message.role === "user") {
      const text = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      if (text.startsWith("I selected these companies.")) phase = "contacts";
      else if (text.startsWith("I selected these named contacts")) phase = "draft";
      else if (/\b(send it|approve|yes send|ship it|go ahead)\b/i.test(text)) phase = "draft";
      else if (/\b(scout|search|find)\b.*\b(companies|startups)\b/i.test(text)) phase = "discover";
    } else if (message.role === "assistant") {
      for (const part of message.parts) {
        if (part.type === "tool-present_ranked_companies") phase = "contacts";
        if (
          part.type === "tool-present_contact_options" ||
          part.type === "tool-draft_pitch" ||
          part.type === "tool-draft_generic_email" ||
          part.type === "tool-send_pitch" ||
          part.type === "tool-bulk_send_pitch" ||
          part.type === "tool-send_generic_email"
        ) {
          phase = "draft";
        }
      }
    }
  }
  return phase;
}

export function ChatWindow({
  thread,
  onOpenSidebar,
}: {
  thread: Thread;
  onOpenSidebar?: () => void;
}) {
  const workflowPhaseRef = useRef<WorkflowPhase>(initialWorkflowPhase(thread.messages));
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, workflowPhase: workflowPhaseRef.current },
        }),
      }),
    [],
  );
  const { messages, sendMessage, status, stop, error } = useChat({
    id: thread.id,
    messages: thread.messages,
    transport,
  });

  useEffect(() => {
    workflowPhaseRef.current = initialWorkflowPhase(thread.messages);
  }, [thread.id, thread.messages]);

  // Persist on change
  const lastPersisted = useRef<number>(0);
  useEffect(() => {
    if (status === "streaming") return;
    const now = Date.now();
    if (now - lastPersisted.current < 250) return;
    lastPersisted.current = now;
    upsertThread({
      id: thread.id,
      title: titleFromMessages(messages) || thread.title,
      updatedAt: now,
      messages: messages as UIMessage[],
    });
  }, [messages, status, thread.id, thread.title]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, [thread.id]);
  useEffect(() => {
    if (status === "ready") textareaRef.current?.focus();
  }, [status]);

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (status === "ready" && workflowPhaseRef.current === "send") {
      workflowPhaseRef.current = "draft";
    }
  }, [status]);

  const handleSubmit = (message: { text?: string }) => {
    const value = message.text?.trim() || textareaRef.current?.value?.trim();
    if (!value) return;
    if (/\b(scout|search|find)\b.*\b(companies|startups)\b/i.test(value)) {
      workflowPhaseRef.current = "discover";
    } else if (
      workflowPhaseRef.current === "draft" &&
      /\b(send it|approve|yes send|ship it|go ahead)\b/i.test(value) &&
      !/\b(don't|do not|never)\s+(send|approve)\b/i.test(value) &&
      messages.some((existing) =>
        existing.parts.some(
          (part) => part.type === "tool-draft_pitch" || part.type === "tool-draft_generic_email",
        ),
      )
    ) {
      workflowPhaseRef.current = "send";
    }
    sendMessage({ text: value });
    if (textareaRef.current) textareaRef.current.value = "";
  };

  const showEmpty = messages.length === 0;
  const isMobile = useIsMobile();
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => {
    setPanelOpen(!isMobile);
  }, [isMobile]);
  const activityCount = (messages as UIMessage[]).reduce(
    (n, m) => n + m.parts.filter((part) => part.type.startsWith("tool-")).length,
    0,
  );

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b bg-background/60 px-3 py-2">
          <div className="flex items-center gap-1 min-w-0">
            {onOpenSidebar ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                onClick={onOpenSidebar}
                aria-label="Open menu"
              >
                <Menu className="h-4 w-4" />
              </Button>
            ) : null}
            <div className="text-xs text-muted-foreground truncate">
              {isLoading ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Bot is running
                </span>
              ) : (
                <span>{activityCount > 0 ? `${activityCount} actions` : "Ready"}</span>
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setPanelOpen((v) => !v)}
            aria-label={panelOpen ? "Hide activity" : "Show activity"}
          >
            {panelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
        </div>

        <Conversation className="flex-1">
          <ConversationContent>
            {showEmpty ? (
              <EmptyState
                onPick={(t) => {
                  workflowPhaseRef.current = "discover";
                  sendMessage({ text: t });
                }}
              />
            ) : null}
            {messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent>
                  {m.parts.map((part, i) => {
                    if (part.type === "text") {
                      return <MessageResponse key={i}>{part.text}</MessageResponse>;
                    }
                    if (part.type?.startsWith("tool-")) {
                      return (
                        <ToolPart
                          key={i}
                          part={part}
                          disabled={isLoading}
                          onSelect={(text, phase) => {
                            workflowPhaseRef.current = phase;
                            sendMessage({ text });
                          }}
                        />
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))}
            {status === "submitted" ? (
              <Message from="assistant">
                <MessageContent>
                  <Shimmer>Scouting startups…</Shimmer>
                </MessageContent>
              </Message>
            ) : null}
            {error ? (
              <div className="mx-auto w-full max-w-2xl rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <div className="font-medium">The bot couldn’t respond</div>
                <div className="mt-1 whitespace-pre-wrap break-words opacity-90">
                  {error.message || "Unknown error"}
                </div>
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t bg-background p-4">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              ref={textareaRef}
              placeholder="Scout companies matching your ICP, or choose companies and contacts to continue"
              disabled={isLoading}
            />
            <PromptInputFooter className="justify-between">
              <FileUploadButton
                onImported={(summary) => {
                  workflowPhaseRef.current = "discover";
                  sendMessage({ text: summary });
                }}
                disabled={isLoading}
              />
              <PromptInputSubmit
                status={status}
                disabled={isLoading && status !== "streaming"}
                onClick={status === "streaming" ? () => stop() : undefined}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>

      {panelOpen ? (
        <div className="hidden w-80 shrink-0 border-l md:block">
          <ActivityPanel messages={messages as UIMessage[]} isRunning={isLoading} />
        </div>
      ) : null}

      {panelOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPanelOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-[85%] max-w-sm border-l bg-background shadow-xl">
            <ActivityPanel messages={messages as UIMessage[]} isRunning={isLoading} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const suggestions = [
    "Scout US-based Seed to Series B startups with 15-80 employees and remote engineering roles",
    "Find European AI/ML and data startups with live openings",
    "Scout Africa and Latin America for qualifying product and marketing roles",
  ];
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-12 text-center">
      <img src={logo} alt="Startup Scout" width={72} height={72} className="rounded-lg" />
      <h2 className="text-2xl font-semibold">Startup Scout</h2>
      <p className="text-muted-foreground">
        Find and rank companies against your ICP first. Choose companies to reveal contact options,
        then select who you want to draft outreach for.
      </p>
      <div className="grid w-full gap-2 text-left text-sm text-muted-foreground sm:grid-cols-3">
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
          <Building2 className="h-4 w-4 shrink-0" /> Scout and rank companies
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
          <UsersRound className="h-4 w-4 shrink-0" /> Select contacts
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
          <BriefcaseBusiness className="h-4 w-4 shrink-0" /> Review drafts before sending
        </div>
      </div>
      <div className="mt-2 flex w-full flex-col gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-md border bg-muted/30 px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function parseCsvRows(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const split = (row: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '"') {
        if (q && row[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (c === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  if (!header.some((h) => /email/.test(h))) {
    return lines.flatMap((l) => (l.match(EMAIL_RE) ?? []).map((m) => ({ email: m })));
  }
  return lines.slice(1).map((row) => {
    const cells = split(row);
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      rec[h] = cells[i] ?? "";
    });
    return rec;
  });
}

function pick(r: Record<string, string>, keys: string[]) {
  for (const k of keys) {
    const v = r[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function FileUploadButton({
  onImported,
  disabled,
}: {
  onImported: (summary: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const handle = async (file: File) => {
    const raw = await file.text();
    const rows = parseCsvRows(raw);
    const imported: { email: string; name?: string; company?: string }[] = [];
    rows.forEach((r) => {
      const email = pick(r, ["email", "email_address", "e-mail"]);
      if (!email || !EMAIL_RE.test(email)) return;
      const name = pick(r, ["name", "full_name", "contact"]);
      const company = pick(r, ["company", "company_name", "organization", "org"]);
      const role = pick(r, ["role", "title", "position", "job_title"]);
      const domain = pick(r, ["domain", "website", "url"]);
      upsertLead({ email, name, companyName: company, role, domain, source: "upload" });
      imported.push({ email, name, company });
    });
    if (!imported.length) {
      onImported(`I uploaded a file "${file.name}" but no valid emails were found.`);
      return;
    }
    const preview = imported
      .slice(0, 20)
      .map((l) => `- ${l.name ?? ""} <${l.email}>${l.company ? ` @ ${l.company}` : ""}`)
      .join("\n");
    const more = imported.length > 20 ? `\n…and ${imported.length - 20} more.` : "";
    onImported(
      `I uploaded "${file.name}" with ${imported.length} contact${imported.length === 1 ? "" : "s"}. Use these as candidate leads: verify the companies and their live roles against my ICP, then show qualifying companies as ranked selection cards. Do not find contacts, draft, or send outreach until I select companies and contacts.\n\n${preview}${more}`,
    );
  };
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label="Upload CSV or list"
        title="Upload CSV or list of contacts"
      >
        <Paperclip className="h-4 w-4" />
      </Button>
    </>
  );
}

type ToolPartShape = {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function ToolPart({
  part,
  onSelect,
  disabled,
}: {
  part: ToolPartShape;
  onSelect: (text: string, phase: WorkflowPhase) => void;
  disabled: boolean;
}) {
  const name = part.type.replace(/^tool-/, "");
  const output =
    part.output && typeof part.output === "object"
      ? (part.output as Record<string, unknown>)
      : undefined;
  const state =
    part.state === "output-available"
      ? "output-available"
      : part.state === "output-error" || part.errorText
        ? "output-error"
        : part.state === "input-streaming"
          ? "input-streaming"
          : "input-available";
  return (
    <div className="my-3 space-y-3">
      {name === "present_ranked_companies" && state === "output-available" && output ? (
        <CompanySelectionCards output={output} onSelect={onSelect} disabled={disabled} />
      ) : null}
      {name === "present_contact_options" && state === "output-available" && output ? (
        <ContactSelectionCards
          input={part.input}
          output={output}
          onSelect={onSelect}
          disabled={disabled}
        />
      ) : null}
      <Tool defaultOpen={false}>
        <ToolHeader type={`tool-${name}` as `tool-${string}`} state={state as never} />
        <ToolContent>
          <ToolInput input={part.input} />
          <ToolOutput output={part.output as never} errorText={part.errorText} />
        </ToolContent>
      </Tool>
    </div>
  );
}

type RankedCompanyCard = {
  name: string;
  domain?: string;
  stage: string;
  employeeCount: number;
  location: string;
  workMode: "remote" | "distributed";
  geographyLabel: string;
  description?: string;
  jobs: Array<{
    title: string;
    url: string;
    location?: string;
    daysOpen?: number;
  }>;
  engineeringRoleCount: number;
  signalRank: number;
  rankingReason: string;
};

function CompanySelectionCards({
  output,
  onSelect,
  disabled,
}: {
  output: Record<string, unknown>;
  onSelect: (text: string, phase: WorkflowPhase) => void;
  disabled: boolean;
}) {
  const companies = Array.isArray(output.companies)
    ? (output.companies as RankedCompanyCard[])
    : [];
  const [selected, setSelected] = useState<string[]>([]);
  if (companies.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        No companies met the verified ICP filters. Try another region or search term.
      </div>
    );
  }
  const toggle = (key: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key),
    );
  };
  const selectedCompanies = companies.filter((company) =>
    selected.includes(company.domain ?? company.name),
  );

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">Ranked companies</h3>
          <p className="text-xs text-muted-foreground">
            {companies.length} companies matched. Select companies to see contact options.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          Ranking uses live-role signals, then geography.
        </span>
      </div>
      <div className="space-y-3">
        {companies.map((company, index) => {
          const key = company.domain ?? company.name;
          return (
            <label
              key={key}
              className="flex cursor-pointer gap-3 rounded-md border p-3 transition hover:bg-muted/40"
            >
              <Checkbox
                checked={selected.includes(key)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(key, checked === true)}
                aria-label={`Select ${company.name}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {index + 1}. {company.name}
                  </span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    Signal {company.signalRank}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {company.stage} · {company.employeeCount} people · {company.workMode} ·{" "}
                  {company.geographyLabel} ({company.location})
                </p>
                <p className="mt-1 text-sm">{company.rankingReason}</p>
                {company.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{company.description}</p>
                ) : null}
                <ul className="mt-2 space-y-1 text-sm">
                  {company.jobs.map((job) => (
                    <li
                      key={`${company.name}-${job.url}`}
                      className="flex flex-wrap items-center gap-x-2"
                    >
                      <BriefcaseBusiness className="h-3.5 w-3.5 text-muted-foreground" />
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium underline underline-offset-2"
                      >
                        {job.title}
                      </a>
                      {job.location ? (
                        <span className="text-xs text-muted-foreground">{job.location}</span>
                      ) : null}
                      {job.daysOpen !== undefined ? (
                        <span className="text-xs text-muted-foreground">
                          {job.daysOpen} days listed
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </label>
          );
        })}
      </div>
      <Button
        className="mt-4"
        disabled={disabled || selectedCompanies.length === 0}
        onClick={() =>
          onSelect(
            `I selected these companies. Find named hiring contacts only for these selections, present them as contact selection cards, then stop and wait. Do not draft or send outreach yet:\n${selectedCompanies
              .map(
                (company) =>
                  `- ${company.name} (${company.domain ?? "domain unknown"}); eligible roles: ${company.jobs.map((job) => `${job.title} - ${job.url}`).join("; ")}`,
              )
              .join("\n")}`,
            "contacts",
          )
        }
      >
        <UsersRound className="mr-2 h-4 w-4" />
        Find contacts for {selectedCompanies.length || "selected"} companies
      </Button>
    </section>
  );
}

type ContactCardRecord = {
  name?: string;
  full_name?: string;
  title?: string;
  role?: string;
  headline?: string;
  email?: string;
  linkedin?: string;
  linkedin_url?: string;
  url?: string;
  source?: string;
};

function ContactSelectionCards({
  input,
  output,
  onSelect,
  disabled,
}: {
  input: unknown;
  output: Record<string, unknown>;
  onSelect: (text: string, phase: WorkflowPhase) => void;
  disabled: boolean;
}) {
  const rawCandidates = Array.isArray(output.contacts)
    ? output.contacts
    : Array.isArray(output.profiles)
      ? output.profiles
      : output.contact && typeof output.contact === "object"
        ? [output.contact]
        : [];
  const contacts = rawCandidates.filter(
    (candidate): candidate is ContactCardRecord =>
      typeof candidate === "object" && candidate !== null,
  );
  const toolInput = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const companyName =
    typeof output.companyName === "string"
      ? output.companyName
      : typeof toolInput.companyName === "string"
        ? toolInput.companyName
        : "Selected company";
  const domain =
    typeof output.domain === "string"
      ? output.domain
      : typeof toolInput.domain === "string"
        ? toolInput.domain
        : "";
  const [selected, setSelected] = useState<string[]>([]);
  if (contacts.length === 0) return null;
  const available = contacts
    .map((contact) => ({
      ...contact,
      displayName: contact.name ?? contact.full_name,
      displayTitle: contact.title ?? contact.role ?? contact.headline,
      profile: contact.linkedin ?? contact.linkedin_url ?? contact.url,
    }))
    .filter((contact) => contact.displayName);
  if (available.length === 0) return null;
  const toggle = (key: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key),
    );
  };
  const selectedContacts = available.filter((contact, index) =>
    selected.includes(contact.email ?? contact.profile ?? `${contact.displayName}-${index}`),
  );

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3">
        <h3 className="font-semibold">Contact options: {companyName}</h3>
        <p className="text-xs text-muted-foreground">
          Select the people you want to research and draft for. Nothing will be sent.
        </p>
      </div>
      <div className="space-y-2">
        {available.map((contact, index) => {
          const key = contact.email ?? contact.profile ?? `${contact.displayName}-${index}`;
          return (
            <label
              key={key}
              className="flex cursor-pointer gap-3 rounded-md border p-3 hover:bg-muted/40"
            >
              <Checkbox
                checked={selected.includes(key)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(key, checked === true)}
                aria-label={`Select ${contact.displayName}`}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{contact.displayName}</div>
                {contact.displayTitle ? (
                  <div className="text-sm text-muted-foreground">{contact.displayTitle}</div>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  {contact.email ? (
                    <a className="underline" href={`mailto:${contact.email}`}>
                      {contact.email}
                    </a>
                  ) : null}
                  {contact.profile ? (
                    <a
                      className="inline-flex items-center gap-1 underline"
                      href={contact.profile}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="h-3 w-3" /> Profile
                    </a>
                  ) : null}
                </div>
                {contact.source ? (
                  <div className="mt-1 break-all text-xs text-muted-foreground">
                    {contact.source}
                  </div>
                ) : null}
              </div>
            </label>
          );
        })}
      </div>
      <Button
        className="mt-4"
        disabled={disabled || selectedContacts.length === 0}
        onClick={() =>
          onSelect(
            `I selected these named contacts for outreach drafts only. Research each selected person and company, then draft individualized messages for review. Do not send anything:\n${selectedContacts
              .map(
                (contact) =>
                  `- ${contact.displayName}${contact.displayTitle ? `, ${contact.displayTitle}` : ""} at ${companyName}${domain ? ` (${domain})` : ""}${contact.email ? `; email: ${contact.email}` : ""}${contact.profile ? `; profile: ${contact.profile}` : ""}${contact.source ? `; source: ${contact.source}` : ""}`,
              )
              .join("\n")}`,
            "draft",
          )
        }
      >
        Draft for {selectedContacts.length || "selected"} contacts
      </Button>
    </section>
  );
}
