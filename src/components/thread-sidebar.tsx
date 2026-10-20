import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Search, UsersRound } from "lucide-react";
import {
  deleteThread,
  loadThreads,
  newThreadId,
  type Thread,
} from "@/lib/threads";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.png";

export function ThreadSidebar() {
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location.pathname });
  const [threads, setThreads] = useState<Thread[]>([]);

  useEffect(() => {
    setThreads(loadThreads());
    const onStorage = () => setThreads(loadThreads());
    window.addEventListener("storage", onStorage);
    const interval = setInterval(onStorage, 1500);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(interval);
    };
  }, []);

  const handleNew = () => {
    const id = newThreadId();
    navigate({ to: "/$threadId", params: { threadId: id } });
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    deleteThread(id);
    const next = loadThreads();
    setThreads(next);
    if (location.includes(id)) {
      if (next.length > 0) {
        navigate({ to: "/$threadId", params: { threadId: next[0].id } });
      } else {
        const fresh = newThreadId();
        navigate({ to: "/$threadId", params: { threadId: fresh } });
      }
    }
  };

  return (
    <aside className="flex h-full w-72 flex-col border-r bg-muted/20">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <img src={logo} alt="" width={28} height={28} className="rounded" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Startup Scout</div>
          <div className="text-xs text-muted-foreground">Startup lead agent</div>
        </div>
      </div>
      <div className="p-3">
        <Button onClick={handleNew} className="w-full" size="sm">
          <Plus className="h-4 w-4" />
          New search
        </Button>
      </div>
      <div className="px-3 pb-2">
        <Link
          to="/contacts"
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
            location === "/contacts"
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          }`}
        >
          <UsersRound className="h-4 w-4" />
          Contact database
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {threads.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            <Search className="mx-auto mb-2 h-4 w-4 opacity-50" />
            No searches yet
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {threads.map((t) => {
              const active = location.endsWith(`/${t.id}`);
              return (
                <li key={t.id}>
                  <div
                    className={`group flex items-center gap-1 rounded-md text-sm ${active ? "bg-accent" : "hover:bg-accent/60"}`}
                  >
                    <Link
                      to="/$threadId"
                      params={{ threadId: t.id }}
                      className="flex-1 truncate px-3 py-2"
                    >
                      {t.title || "New search"}
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(t.id, e)}
                      className="mr-1 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      aria-label="Delete thread"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="border-t p-3 text-[11px] text-muted-foreground">
        Threads are saved in this browser only.
      </div>
    </aside>
  );
}
