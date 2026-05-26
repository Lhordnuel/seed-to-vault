import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChatWindow } from "@/components/chat-window";
import { ThreadSidebar } from "@/components/thread-sidebar";
import { getThread, type Thread } from "@/lib/threads";

export const Route = createFileRoute("/$threadId")({
  head: () => ({
    meta: [
      { title: "Vaultio Scout — Find startups to pitch" },
      {
        name: "description",
        content:
          "AI agent that finds early-stage startups hiring on Wellfound, F6S, YC, and LinkedIn — then drafts personalized Vaultio outreach.",
      },
    ],
  }),
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = useParams({ from: "/$threadId" });
  const [thread, setThread] = useState<Thread | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const existing = getThread(threadId);
    setThread(
      existing ?? {
        id: threadId,
        title: "New search",
        updatedAt: Date.now(),
        messages: [],
      },
    );
    setHydrated(true);
    setSidebarOpen(false);
  }, [threadId]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <ThreadSidebar />
      </div>

      {/* Mobile sidebar drawer */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[85%] max-w-xs bg-background shadow-xl">
            <ThreadSidebar />
          </div>
        </div>
      ) : null}

      <main className="flex-1 min-w-0">
        {hydrated && thread ? (
          <ChatWindow
            key={thread.id}
            thread={thread}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        ) : null}
      </main>
    </div>
  );
}
