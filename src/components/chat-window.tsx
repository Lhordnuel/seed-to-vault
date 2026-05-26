import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { Menu, PanelRightClose, PanelRightOpen } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
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
import { upsertThread, titleFromMessages, type Thread } from "@/lib/threads";
import { useIsMobile } from "@/hooks/use-mobile";
import logo from "@/assets/logo.png";

const transport = new DefaultChatTransport({ api: "/api/chat" });

export function ChatWindow({ thread, onOpenSidebar }: { thread: Thread; onOpenSidebar?: () => void }) {
  const { messages, sendMessage, status, stop } = useChat({
    id: thread.id,
    messages: thread.messages,
    transport,
  });

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

  const handleSubmit = (message: { text?: string }) => {
    const value = message.text?.trim() || textareaRef.current?.value?.trim();
    if (!value) return;
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
    (n, m) => n + m.parts.filter((p: any) => p.type?.startsWith("tool-")).length,
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
                  sendMessage({ text: t });
                }}
              />
            ) : null}
            {messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent>
                  {m.parts.map((part, i) => {
                    if (part.type === "text") {
                      return (
                        <MessageResponse key={i}>{part.text}</MessageResponse>
                      );
                    }
                    if (part.type?.startsWith("tool-")) {
                      return <ToolPart key={i} part={part} />;
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
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t bg-background p-4">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              ref={textareaRef}
              placeholder="e.g. Find AI infra startups on YC hiring backend engineers"
              disabled={isLoading}
            />
            <PromptInputFooter className="justify-end">
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
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setPanelOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[85%] max-w-sm border-l bg-background shadow-xl">
            <ActivityPanel messages={messages as UIMessage[]} isRunning={isLoading} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyState() {
  const suggestions = [
    "Find AI infra startups on YC hiring backend engineers",
    "Search Wellfound for seed-stage fintech startups hiring engineers",
    "F6S: dev-tools startups hiring their first 5 engineers",
  ];
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-12 text-center">
      <img src={logo} alt="Vaultio Scout" width={72} height={72} className="rounded-lg" />
      <h2 className="text-2xl font-semibold">Vaultio Scout</h2>
      <p className="text-muted-foreground">
        Find seed–Series A startups (1–50 people) that are hiring on Wellfound, F6S, YC Jobs, and LinkedIn — then draft personalized Vaultio pitches.
      </p>
      <div className="mt-2 flex w-full flex-col gap-2">
        {suggestions.map((s) => (
          <SuggestionPill key={s} text={s} />
        ))}
      </div>
    </div>
  );
}

function SuggestionPill({ text }: { text: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-left text-sm text-muted-foreground">
      {text}
    </div>
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

function ToolPart({ part }: { part: ToolPartShape }) {
  const name = part.type.replace(/^tool-/, "");
  const state =
    part.state === "output-available"
      ? "output-available"
      : part.state === "output-error" || part.errorText
        ? "output-error"
        : part.state === "input-streaming"
          ? "input-streaming"
          : "input-available";
  return (
    <Tool defaultOpen={false}>
      <ToolHeader type={`tool-${name}` as `tool-${string}`} state={state as never} />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput output={part.output as never} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  );
}
