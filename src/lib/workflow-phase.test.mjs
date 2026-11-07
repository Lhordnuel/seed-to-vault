import assert from "node:assert/strict";
import test from "node:test";
import { hasExplicitDraftApproval, isEmailCompositionRequest } from "./workflow-phase.ts";

test("recognizes email composition and send requests", () => {
  assert.equal(isEmailCompositionRequest("Can you send an email to Alex?"), true);
  assert.equal(isEmailCompositionRequest("Draft a follow-up email"), true);
  assert.equal(isEmailCompositionRequest("What email address should I use?"), false);
});

const draftMessage = {
  role: "assistant",
  parts: [
    {
      type: "tool-draft_pitch",
      state: "output-available",
      output: { status: "draft" },
    },
    { type: "text", text: "Subject: Quick idea\n\nDraft: Hello there..." },
  ],
};

test("allows an explicit approval after a completed draft", () => {
  assert.equal(
    hasExplicitDraftApproval([
      draftMessage,
      { role: "user", parts: [{ type: "text", text: "Looks good, send it." }] },
    ]),
    true,
  );
});

test("allows concise approval phrasing after a completed draft", () => {
  assert.equal(
    hasExplicitDraftApproval([
      draftMessage,
      { role: "user", parts: [{ type: "text", text: "I approve." }] },
    ]),
    true,
  );
  assert.equal(
    hasExplicitDraftApproval([
      draftMessage,
      {
        role: "user",
        parts: [{ type: "text", text: "Go ahead and send it." }],
      },
    ]),
    true,
  );
});

test("blocks approval before a completed draft", () => {
  assert.equal(
    hasExplicitDraftApproval([
      { role: "user", parts: [{ type: "text", text: "Send it." }] },
      draftMessage,
    ]),
    false,
  );
});

test("blocks a draft request that is not an approval", () => {
  assert.equal(
    hasExplicitDraftApproval([
      draftMessage,
      { role: "user", parts: [{ type: "text", text: "Can you make it shorter?" }] },
    ]),
    false,
  );
});

test("does not mistake an edit instruction for send approval", () => {
  assert.equal(
    hasExplicitDraftApproval([
      draftMessage,
      {
        role: "user",
        parts: [{ type: "text", text: "Go ahead and make it shorter." }],
      },
    ]),
    false,
  );
});

test("blocks negated approval language", () => {
  assert.equal(
    hasExplicitDraftApproval([
      draftMessage,
      { role: "user", parts: [{ type: "text", text: "Don't send it yet." }] },
    ]),
    false,
  );
});

test("blocks draft tool calls that failed or have no output", () => {
  assert.equal(
    hasExplicitDraftApproval([
      {
        role: "assistant",
        parts: [{ type: "tool-draft_generic_email", state: "output-error" }],
      },
      { role: "user", parts: [{ type: "text", text: "Approve." }] },
    ]),
    false,
  );
});

test("requires the assistant to show the draft for review", () => {
  assert.equal(
    hasExplicitDraftApproval([
      {
        role: "assistant",
        parts: [
          {
            type: "tool-draft_pitch",
            state: "output-available",
            output: { status: "draft" },
          },
          { type: "text", text: "I prepared your email." },
        ],
      },
      { role: "user", parts: [{ type: "text", text: "Approve." }] },
    ]),
    false,
  );
});
