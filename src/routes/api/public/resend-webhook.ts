import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { recordEvent, type ResendEventType } from "@/lib/email-events.server";

/**
 * Resend webhook endpoint (Svix-signed).
 * If RESEND_WEBHOOK_SECRET is set (format: "whsec_<base64>"), we verify the
 * svix-id / svix-timestamp / svix-signature headers before processing.
 */

function verifySvix(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
): boolean {
  // Reject replays older than 5 minutes
  const ts = Number(timestamp);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;

  const key = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(key, "base64");
  } catch {
    return false;
  }

  const signed = `${id}.${timestamp}.${body}`;
  const expected = createHmac("sha256", keyBytes).update(signed).digest("base64");

  // Header looks like: "v1,<sig> v1,<sig2>"
  const sigs = signatureHeader.split(" ").map((s) => s.split(",")[1]).filter(Boolean);
  for (const sig of sigs) {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export const Route = createFileRoute("/api/public/resend-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = await request.text();
          const secret = process.env.RESEND_WEBHOOK_SECRET;

          if (!secret) {
            return new Response("Webhook verification is not configured", { status: 503 });
          }
          const id = request.headers.get("svix-id");
          const timestamp = request.headers.get("svix-timestamp");
          const signature = request.headers.get("svix-signature");
          if (!id || !timestamp || !signature) {
            return new Response("Missing svix headers", { status: 401 });
          }
          if (!verifySvix(secret, id, timestamp, raw, signature)) {
            return new Response("Invalid signature", { status: 401 });
          }

          const body = JSON.parse(raw) as {
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
            await recordEvent({
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
