import { createFileRoute } from "@tanstack/react-router";
import { hasValidAccessSession } from "@/lib/access-session.server";

export const Route = createFileRoute("/api/session")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        new Response(null, {
          status: hasValidAccessSession(request) ? 204 : 401,
          headers: { "Cache-Control": "no-store" },
        }),
    },
  },
});
