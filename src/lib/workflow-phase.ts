type ChatMessage = {
  role?: unknown;
  parts?: unknown;
};

type ChatPart = {
  type?: unknown;
  text?: unknown;
  state?: unknown;
  output?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getParts(message: ChatMessage): ChatPart[] {
  return Array.isArray(message.parts) ? message.parts.filter(isRecord) : [];
}

function getText(message: ChatMessage): string {
  return getParts(message)
    .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

export function isEmailCompositionRequest(text: string): boolean {
  return (
    /\b(?:email|e-mail)\b/i.test(text) &&
    /\b(?:draft|write|compose|send|follow[- ]?up|reply|intro|thank(?:-|\s)?you)\b/i.test(text)
  );
}

function hasCompletedDraft(message: ChatMessage): boolean {
  const parts = getParts(message);
  const hasDraftToolResult = parts.some(
    (part) =>
      (part.type === "tool-draft_pitch" || part.type === "tool-draft_generic_email") &&
      part.state === "output-available" &&
      part.output !== undefined &&
      part.output !== null,
  );
  const hasVisibleDraft = parts.some(
    (part) =>
      part.type === "text" && typeof part.text === "string" && /\bsubject\b/i.test(part.text),
  );
  return hasDraftToolResult && hasVisibleDraft;
}

export function hasExplicitDraftApproval(messages: readonly unknown[]): boolean {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (isRecord(message) && message.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return false;

  const latestUserMessage = messages[latestUserIndex];
  if (!isRecord(latestUserMessage)) return false;

  const approvalText = getText(latestUserMessage);
  const normalizedApproval = approvalText
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
  const explicitlyApproved =
    /^(?:(?:yes|okay|ok|looks good|approved|please|please do|that works)\s*,?\s*)?(?:send(?:\s+(?:it|them|the drafts?))?|approve(?:\s+(?:it|them|this))?|i approve(?:\s+(?:it|them))?|approved|ship it|yes send(?: it)?|go ahead(?: and send (?:it|them))?)$/i.test(
      normalizedApproval,
    ) || /^(?:go ahead)$/i.test(normalizedApproval);
  const approvalWasNegated = /\b(don't|do not|never|not)\s+(send|approve)\b/i.test(approvalText);
  if (!explicitlyApproved || approvalWasNegated) return false;

  for (let index = latestUserIndex - 1; index >= 0; index--) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "assistant") continue;
    return hasCompletedDraft(message);
  }

  return false;
}
