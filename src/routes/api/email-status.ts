import { createFileRoute } from "@tanstack/react-router";

/**
 * Poll Resend for the status of one or more email IDs.
 * Body: { ids: string[] }
 * Returns: { statuses: Array<{ id, to, subject, last_event, created_at, ... }> }
 *
 * This complements the webhook endpoint — the in-memory webhook store does not
 * survive Worker cold starts, so we read live status from Resend directly.
 */
export const Route = createFileRoute("/api/email-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const lovableKey = process.env.LOVABLE_API_KEY;
        const resendKey = process.env.RESEND_API_KEY;
        if (!lovableKey || !resendKey) {
          return new Response(
            JSON.stringify({ error: "Resend connector not configured" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        let body: { ids?: unknown } = {};
        try {
          body = await request.json();
        } catch {
          /* ignore */
        }
        const ids = Array.isArray(body.ids)
          ? (body.ids.filter((x) => typeof x === "string") as string[]).slice(0, 100)
          : [];

        const statuses = await Promise.all(
          ids.map(async (id) => {
            try {
              const r = await fetch(
                `https://connector-gateway.lovable.dev/resend/emails/${encodeURIComponent(id)}`,
                {
                  headers: {
                    Authorization: `Bearer ${lovableKey}`,
                    "X-Connection-Api-Key": resendKey,
                  },
                },
              );
              const data = (await r.json().catch(() => ({}))) as Record<string, any>;
              if (!r.ok) {
                return { id, error: `${r.status}`, raw: data };
              }
              return {
                id,
                to: Array.isArray(data.to) ? data.to[0] : data.to,
                subject: data.subject,
                last_event: data.last_event ?? data.status,
                created_at: data.created_at,
              };
            } catch (e) {
              return { id, error: (e as Error).message };
            }
          }),
        );

        return new Response(JSON.stringify({ statuses }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
