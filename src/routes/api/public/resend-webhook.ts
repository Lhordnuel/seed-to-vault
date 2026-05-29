import { createFileRoute } from "@tanstack/react-router";
import { recordEvent, type ResendEventType } from "@/lib/email-events.server";

/**
 * Resend webhook endpoint. Public — no signature verification configured by
 * default. If RESEND_WEBHOOK_SECRET is set, you can add svix verification
 * (Resend uses svix headers). Keeping it simple to start.
 */
export const Route = createFileRoute("/api/public/resend-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            type?: ResendEventType;
            created_at?: string;
            data?: {
              email_id?: string;
              to?: string[] | string;
              subject?: string;
              bounce?: { message?: string };
            };
          };
          const type = body.type ?? "unknown";
          const data = body.data ?? {};
          const to = Array.isArray(data.to) ? data.to[0] : data.to;
          if (to) {
            recordEvent({
              type,
              email: to,
              subject: data.subject,
              resendId: data.email_id,
              at: body.created_at ? Date.parse(body.created_at) || Date.now() : Date.now(),
              bounceReason: data.bounce?.message,
            });
          }
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ ok: false, error: (e as Error).message }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
      },
      GET: async () =>
        new Response(
          "Resend webhook endpoint. POST events here from Resend dashboard.",
          { status: 200 },
        ),
    },
  },
});
