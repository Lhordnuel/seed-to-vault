import { createFileRoute } from "@tanstack/react-router";
import { summarize } from "@/lib/email-events.server";

/** Public read of warm-instance email delivery status. */
export const Route = createFileRoute("/api/email-events")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ events: await summarize() }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        }),
    },
  },
});
