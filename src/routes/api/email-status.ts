import { createFileRoute } from "@tanstack/react-router";
import { hasValidAccessSession } from "@/lib/access-session.server";
import { getResendEmail } from "@/lib/resend.server";

/**
 * Poll Resend for the status of one or more email IDs.
 * Body: { ids: string[] }
 * Returns: { statuses: Array<{ id, to, subject, last_event, created_at, ... }>, notice? }
 *
 * This complements the webhook endpoint — the in-memory webhook store does not
 * survive Worker cold starts, so we read live status from Resend directly.
 */
export const Route = createFileRoute("/api/email-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!hasValidAccessSession(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const resendKey = process.env.RESEND_API_KEY;
        if (!resendKey) {
          return new Response(
            JSON.stringify({ error: "RESEND_API_KEY secret is not configured." }),
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

        let authNotice: string | undefined;
        const uniqueIds = [...new Set(ids)];
        const statuses = await Promise.all(
          uniqueIds.map(async (id) => {
            try {
              const data = await getResendEmail(id);
              return {
                id,
                to: Array.isArray(data.to) ? data.to[0] : data.to,
                subject: data.subject,
                last_event: data.last_event ?? data.status,
                created_at: data.created_at,
              };
            } catch (error) {
              const message = (error as Error).message;
              if (/Resend (401|403):/.test(message)) {
                authNotice =
                  "Resend could not read email status with this API key. Use a Resend API key with permission to read emails.";
                return { id, last_event: "sent" };
              }
              return { id, last_event: "sent", error: message };
            }
          }),
        );

        return new Response(JSON.stringify({ statuses, notice: authNotice }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
