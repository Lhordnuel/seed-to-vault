import assert from "node:assert/strict";
import test from "node:test";
import {
  canStartAutomationCycle,
  cyclesUsedToday,
  createSingleSendApprovalGate,
  isContactEligibleToSend,
  isNamedWorkEmail,
  isOptOutReply,
} from "./automation-policy.ts";

test("daily cycle accounting resets on a new UTC date", () => {
  assert.equal(cyclesUsedToday("2026-10-20", 3, "2026-10-21"), 0);
  assert.equal(cyclesUsedToday("2026-10-21", 2, "2026-10-21"), 2);
});

test("automation cannot exceed three daily cycles or overlap a live lock", () => {
  const baseline = {
    enabled: true,
    cycleDate: "2026-10-21",
    storedCount: 2,
    utcDate: "2026-10-21",
    lockUntil: null,
    now: 100,
  };
  assert.equal(canStartAutomationCycle(baseline), true);
  assert.equal(canStartAutomationCycle({ ...baseline, storedCount: 3 }), false);
  assert.equal(canStartAutomationCycle({ ...baseline, lockUntil: 101 }), false);
  assert.equal(canStartAutomationCycle({ ...baseline, enabled: false }), false);
});

test("new email sends require a reviewed, matching, non-opted-out contact", () => {
  const contact = {
    email: "person@acme.com",
    emailStatus: "valid",
    doNotContact: false,
    optedOutAt: null,
    commercializationEligible: true,
    reviewedAt: "2026-10-21T12:00:00.000Z",
    lawfulBasis: "legitimate_interest",
    recipientEmail: "person@acme.com",
  };
  assert.equal(isContactEligibleToSend(contact), true);
  assert.equal(isContactEligibleToSend({ ...contact, doNotContact: true }), false);
  assert.equal(
    isContactEligibleToSend({ ...contact, optedOutAt: "2026-10-21T12:00:00.000Z" }),
    false,
  );
  assert.equal(isContactEligibleToSend({ ...contact, reviewedAt: null }), false);
  assert.equal(isContactEligibleToSend({ ...contact, recipientEmail: "other@acme.com" }), false);
});

test("only named emails on the company domain pass the work-email check", () => {
  assert.equal(isNamedWorkEmail("ada@acme.com", "acme.com"), true);
  assert.equal(isNamedWorkEmail("careers@acme.com", "acme.com"), false);
  assert.equal(isNamedWorkEmail("ada@gmail.com", "acme.com"), false);
});

test("clear unsubscribe replies suppress future automation sends", () => {
  assert.equal(isOptOutReply("Please stop emailing me."), true);
  assert.equal(isOptOutReply("Unsubscribe"), true);
  assert.equal(isOptOutReply("I am not interested, please remove me."), true);
  assert.equal(isOptOutReply("Thanks, tell me more about the product."), false);
});

test("one explicit send approval authorizes at most one recipient", () => {
  const claim = createSingleSendApprovalGate(true);
  assert.equal(claim(), true);
  assert.equal(claim(), false);
  assert.equal(createSingleSendApprovalGate(false)(), false);
});
