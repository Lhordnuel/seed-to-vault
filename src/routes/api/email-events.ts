import { createFileRoute } from "@tanstack/react-router";
import { summarize } from "@/lib/email-events.server";
import { hasValidAccessSession } from "@/lib/access-session.server";

/** Read delivery history for an authenticated app session. */
export const Route = createFileRoute("/api/email-events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!hasValidAccessSession(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        return new Response(JSON.stringify({ events: await summarize() }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
