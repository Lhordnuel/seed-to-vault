import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Link2,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { ThreadSidebar } from "@/components/thread-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ContactRecord = {
  id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  email_status: string;
  linkedin_url: string | null;
  do_not_contact: boolean;
  lawful_basis: string | null;
  commercialization_eligible: boolean;
  first_sourced_at: string;
  last_sourced_at: string;
  company: {
    name: string;
    domain: string;
    linkedin_url: string | null;
    stage: string | null;
    employee_count: number | null;
    industry: string | null;
  } | null;
  sources: Array<{
    provider: string;
    source_url: string | null;
    observed_at: string;
  }>;
  isExternal: boolean;
};

type ContactsResponse = {
  contacts: ContactRecord[];
  hasMore: boolean;
  page: number;
  total: number;
  searchSource?: "database" | "apollo";
};

export const Route = createFileRoute("/contacts")({
  head: () => ({
    meta: [
      { title: "Contact database - Startup Scout" },
      { name: "description", content: "Review sourced startup contacts and their provenance." },
    ],
  }),
  component: ContactsPage,
});

function ContactsPage() {
  const [records, setRecords] = useState<ContactRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [searchSource, setSearchSource] = useState<ContactsResponse["searchSource"]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingOptOut, setPendingOptOut] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const loadRecords = useCallback(async (pageToLoad: number, searchTerm = "") => {
    const requestId = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setSearchSource(undefined);
    try {
      const params = new URLSearchParams({ page: String(pageToLoad) });
      if (searchTerm.trim()) params.set("q", searchTerm.trim());
      const response = await fetch(`/api/contacts?${params}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "Your session expired. Refresh the page and unlock the app again."
            : "Could not load contacts from Supabase.",
        );
      }
      const result = (await response.json()) as ContactsResponse;
      if (requestId !== requestVersion.current) return;
      setRecords(result.contacts);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setPage(result.page);
      setSearchSource(result.searchSource);
    } catch (e) {
      if (requestId === requestVersion.current) {
        setError((e as Error).message);
      }
    } finally {
      if (requestId === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRecords(0, query), query.trim() ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [loadRecords, query]);

  const companyCount = new Set(records.map((record) => record.company?.domain).filter(Boolean)).size;
  const emailCount = records.filter((record) => record.email).length;
  const optedOutCount = records.filter((record) => record.do_not_contact).length;

  const markOptedOut = async (contactId: string) => {
    setPendingOptOut(contactId);
    setError(null);
    try {
      const response = await fetch("/api/contacts", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error ?? "Could not save the contact preference.");
      }
      await loadRecords(page, query);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPendingOptOut(null);
    }
  };

  return (
    <div className="flex h-screen min-h-[560px] w-screen overflow-hidden bg-muted/30">
      <div className="hidden md:block">
        <ThreadSidebar />
      </div>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Workspace / Records</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Contact database</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Companies and people found by your scouting providers, with source history and contact preferences.
              </p>
            </div>
            <Button variant="outline" onClick={() => void loadRecords(page, query)} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <StatCard
              label={query.trim() ? "Matching contacts" : "Saved contacts"}
              value={total}
              icon={<UsersRound className="h-4 w-4" />}
            />
            <StatCard label="Companies in this page" value={companyCount} icon={<Building2 className="h-4 w-4" />} />
            <StatCard label="Email opt-outs" value={optedOutCount} icon={<ShieldCheck className="h-4 w-4" />} />
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <Link to="/" className="text-sm font-medium text-primary hover:underline md:hidden">
              Back to scouting
            </Link>
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search saved contacts by company name; searches Apollo if none match"
                className="pl-9"
                aria-label="Search contacts"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {emailCount} contacts with email on this page
            </p>
          </div>

          {error ? (
            <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <section className="mt-5 overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-semibold">Sourced contacts</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {loading
                    ? "Searching saved contacts…"
                    : searchSource === "apollo"
                      ? `${records.length} results from Apollo · not saved`
                      : `${records.length} records shown${searchSource === "database" ? " · from saved contacts" : ""}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous page"
                  disabled={loading || page === 0}
                  onClick={() => void loadRecords(page - 1, query)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-12 text-center text-xs text-muted-foreground">
                  {page + 1}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next page"
                  disabled={loading || !hasMore}
                  onClick={() => void loadRecords(page + 1, query)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="px-5 py-16 text-center text-sm text-muted-foreground">
                Loading saved contacts…
              </div>
            ) : records.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <UsersRound className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <h3 className="mt-3 font-medium">
                  {query.trim()
                    ? "No matching contacts found"
                    : "Your contact list is ready"}
                </h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  {query.trim()
                    ? "No saved contacts or Apollo results matched that company. Try another company name."
                    : "Run a startup or contact search in chat. Sourced people and their provider history will appear here."}
                </p>
                {!query.trim() ? (
                  <Button asChild className="mt-4">
                    <Link to="/">Start scouting</Link>
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="divide-y">
                {records.map((record) => {
                  const latestSource = record.sources[0];
                  return (
                    <article key={record.id} className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h3 className="font-semibold">{record.full_name}</h3>
                          {record.title ? (
                            <span className="text-sm text-muted-foreground">· {record.title}</span>
                          ) : null}
                          {record.do_not_contact ? (
                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                              Do not contact
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {record.company?.name ?? "Unknown company"}
                          {record.company?.stage ? ` · ${record.company.stage}` : ""}
                          {record.company?.employee_count != null
                            ? ` · ${record.company.employee_count} employees`
                            : ""}
                        </p>
                        {record.company ? (
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            {record.company.domain ? (
                              <a href={`https://${record.company.domain}`} target="_blank" rel="noreferrer" className="hover:underline">
                                {record.company.domain}
                              </a>
                            ) : null}
                            {record.company.linkedin_url ? (
                              <a href={record.company.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                                <Link2 className="h-3 w-3" />
                                Company profile
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                          {record.email ? (
                            <a className="inline-flex items-center gap-1.5 hover:underline" href={`mailto:${record.email}`}>
                              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                              {record.email}
                              <span className="text-xs text-muted-foreground">({record.email_status})</span>
                            </a>
                          ) : null}
                          {record.linkedin_url ? (
                            <a
                              className="inline-flex items-center gap-1.5 text-primary hover:underline"
                              href={record.linkedin_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              LinkedIn profile
                            </a>
                          ) : null}
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                          Source: {latestSource?.provider ?? "Not recorded"}
                          {latestSource?.observed_at
                            ? ` · Last checked ${new Date(latestSource.observed_at).toLocaleDateString()}`
                            : ""}
                          {latestSource?.source_url ? (
                            <>
                              {" · "}
                              <a href={latestSource.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                                View source
                              </a>
                            </>
                          ) : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="text-right text-xs text-muted-foreground">
                          <p>{record.sources.length} source observations</p>
                          <p className="mt-1">
                            Providers: {[...new Set(record.sources.map((source) => source.provider))].join(", ") || "Not recorded"}
                          </p>
                          <p className="mt-1">
                            {record.commercialization_eligible && record.lawful_basis
                              ? "Reviewed for permitted use"
                              : "Not reviewed for redistribution"}
                          </p>
                        </div>
                        {!record.isExternal && !record.do_not_contact ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pendingOptOut === record.id}
                            onClick={() => void markOptedOut(record.id)}
                            aria-label={`Mark ${record.full_name} as do not contact`}
                          >
                            <CircleOff className="mr-1.5 h-3.5 w-3.5" />
                            {pendingOptOut === record.id ? "Saving…" : "Opt out"}
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Sourced data is not automatically cleared for resale or outreach. Review provider terms, applicable privacy rules, lawful basis, retention, and opt-outs before any secondary use.
          </p>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-4 shadow-sm">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        {label}
        {icon}
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
