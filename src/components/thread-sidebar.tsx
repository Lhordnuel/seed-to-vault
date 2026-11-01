import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Search, UsersRound } from "lucide-react";
import { deleteThread, loadThreads, newThreadId, type Thread } from "@/lib/threads";
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
    <aside className="flex h-full w-72 flex-col border-r border-white/10 bg-[#0f172a] text-slate-100 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-sky-400 shadow-lg shadow-violet-500/25">
          <img src={logo} alt="Startup Scout" width={22} height={22} className="rounded-md" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">Startup Scout</div>
          <div className="text-[11px] text-slate-400">Startup lead agent</div>
        </div>
      </div>
      <div className="p-3">
        <Button
          onClick={handleNew}
          className="w-full justify-center gap-2 rounded-xl border border-violet-400/30 bg-gradient-to-r from-violet-500 to-indigo-500 text-white shadow-lg shadow-violet-500/20 hover:brightness-110"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          New search
        </Button>
      </div>
      <div className="px-3 pb-2">
        <Link
          to="/contacts"
          className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-all ${
            location === "/contacts"
              ? "bg-white/10 font-medium text-white shadow-inner shadow-slate-900/30"
              : "text-slate-300 hover:bg-white/5 hover:text-white"
          }`}
        >
          <UsersRound className="h-4 w-4" />
          Contact database
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {threads.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-slate-400">
            <Search className="mx-auto mb-2 h-4 w-4 opacity-60" />
            No searches yet
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {threads.map((t) => {
              const active = location.endsWith(`/${t.id}`);
              return (
                <li key={t.id}>
                  <div
                    className={`group flex items-center gap-1 rounded-xl border text-sm transition-all ${active ? "border-violet-400/40 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "border-transparent hover:border-white/10 hover:bg-white/5"}`}
                  >
                    <Link
                      to="/$threadId"
                      params={{ threadId: t.id }}
                      className="flex-1 truncate px-3 py-2.5 text-slate-200"
                    >
                      {t.title || "New search"}
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(t.id, e)}
                      className="mr-1 rounded-md p-1 text-slate-400 opacity-0 transition hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
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
      <div className="border-t border-white/10 p-3 text-[11px] text-slate-400">
        Threads are saved in this browser only.
      </div>
    </aside>
  );
}
