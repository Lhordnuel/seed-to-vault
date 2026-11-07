export const MAX_AUTOMATION_CYCLES_PER_UTC_DAY = 3;

export function createSingleSendApprovalGate(enabled: boolean): () => boolean {
  let consumed = false;
  return () => {
    if (!enabled || consumed) return false;
    consumed = true;
    return true;
  };
}

export function cyclesUsedToday(
  cycleDate: string | null | undefined,
  storedCount: number,
  utcDate: string,
): number {
  if (cycleDate !== utcDate) return 0;
  return Math.min(MAX_AUTOMATION_CYCLES_PER_UTC_DAY, Math.max(0, storedCount));
}

export function canStartAutomationCycle(input: {
  enabled: boolean;
  cycleDate: string | null;
  storedCount: number;
  utcDate: string;
  lockUntil: number | null;
  now: number;
}): boolean {
  return (
    input.enabled &&
    (input.lockUntil === null || input.lockUntil <= input.now) &&
    cyclesUsedToday(input.cycleDate, input.storedCount, input.utcDate) <
      MAX_AUTOMATION_CYCLES_PER_UTC_DAY
  );
}

export function isContactEligibleToSend(input: {
  email: string | null;
  emailStatus: string;
  doNotContact: boolean;
  optedOutAt: string | null;
  commercializationEligible: boolean;
  reviewedAt: string | null;
  lawfulBasis: string | null;
  recipientEmail: string;
}): boolean {
  return (
    !!input.email &&
    input.email.toLowerCase() === input.recipientEmail.toLowerCase() &&
    input.emailStatus === "valid" &&
    !input.doNotContact &&
    !input.optedOutAt &&
    input.commercializationEligible &&
    !!input.reviewedAt &&
    !!input.lawfulBasis
  );
}

export function isNamedWorkEmail(email: string, domain: string): boolean {
  const [local, emailDomain] = email.trim().toLowerCase().split("@");
  if (!local || emailDomain !== domain.toLowerCase()) return false;
  const normalizedLocal = local.replace(/[^a-z]/gi, "");
  const generic =
    /^(admin|billing|careers|contact|hello|help|hr|info|jobs|marketing|office|people|press|recruiting|sales|support|talent|team|noreply|donotreply|notifications?)$/;
  return !generic.test(normalizedLocal) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isOptOutReply(body: string): boolean {
  return /\b(unsubscribe|opt[\s-]?out|remove me|stop(?: emailing| contacting)?|do not (?:email|contact)|don't (?:email|contact)|not interested)\b/i.test(
    body,
  );
}
