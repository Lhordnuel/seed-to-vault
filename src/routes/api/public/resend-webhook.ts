import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { recordEvent, type ResendEventType } from "@/lib/email-events.server";
import { getReceivedResendEmail } from "@/lib/resend.server";
import { storeInboundReply } from "@/lib/automation.server";

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
  const sigs = signatureHeader
    .split(" ")
    .map((s) => s.split(",")[1])
    .filter(Boolean);
  for (const sig of sigs) {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

function emailAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase();
}

function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
              from?: string;
              to?: string[] | string;
              subject?: string;
              bounce?: { message?: string };
            };
          };
          const type = body.type ?? "unknown";
          const data = body.data ?? {};
          if (type === "email.received") {
            const receivedId = data.email_id;
            if (!receivedId) return new Response("Missing received email ID", { status: 400 });
            const received = await getReceivedResendEmail(receivedId);
            const sender = emailAddress(received.from);
            const receivedFor = Array.isArray(received.received_for)
              ? received.received_for.find((value): value is string => typeof value === "string")
              : undefined;
            const receivedTo = Array.isArray(received.to)
              ? received.to.find((value): value is string => typeof value === "string")
              : typeof received.to === "string"
                ? received.to
                : undefined;
            const recipient = emailAddress(receivedFor) ?? emailAddress(receivedTo);
            if (!sender || !recipient) {
              return new Response("Received email is missing sender or recipient", { status: 400 });
            }
            const expectedReplyAddress = (process.env.RESEND_REPLY_ADDRESS ?? "nuel@vaultio.tech")
              .trim()
              .toLowerCase();
            if (recipient !== expectedReplyAddress) {
              return Response.json({ ok: true, matched: false });
            }
            const text =
              typeof received.text === "string" ? received.text : plainText(received.html);
            const result = await storeInboundReply({
              resendId: receivedId,
              senderEmail: sender,
              recipientEmail: recipient,
              subject: typeof received.subject === "string" ? received.subject : "",
              body: text,
              receivedAt: typeof received.created_at === "string" ? received.created_at : undefined,
            });
            return Response.json({ ok: true, matched: result.matched });
          }
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
          console.error("[resend-webhook] event processing failed", e);
          return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
      GET: async () =>
        new Response("Resend webhook endpoint. POST events here from Resend dashboard.", {
          status: 200,
        }),
    },
  },
});
