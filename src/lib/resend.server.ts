type ResendPayload = {
  from: string;
  to: string[];
  cc?: string[];
  reply_to?: string;
  subject: string;
  text: string;
  html: string;
};

async function resendRequest(path: string, init?: RequestInit) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY secret is not configured.");
  }

  const response = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.headers ?? {}),
    },
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Resend ${response.status}: ${JSON.stringify(body)}`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Resend returned an invalid response.");
  }

  return body as Record<string, unknown>;
}

export async function sendResendEmail(payload: ResendPayload): Promise<string> {
  const result = await resendRequest("/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (typeof result.id !== "string") {
    throw new Error("Resend did not return an email ID.");
  }
  return result.id;
}

export function getResendEmail(id: string) {
  return resendRequest(`/emails/${encodeURIComponent(id)}`);
}
