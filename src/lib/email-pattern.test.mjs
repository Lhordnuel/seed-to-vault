import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmailCandidate,
  extractSitePeople,
  extractPublishedEmails,
  inferEmailPattern,
  isWorkEmailForDomain,
  patternForPublishedEmail,
  patternFromHunter,
} from "./email-pattern.ts";

test("extracts published company emails and decodes common obfuscations", () => {
  assert.deepEqual(
    extractPublishedEmails(
      "mailto:nora@acme.com, team [at] acme [dot] com, and jane&#64;acme.com",
      "acme.com",
    ),
    ["nora@acme.com", "jane@acme.com"],
  );
});

test("decodes Cloudflare-protected email addresses", () => {
  const email = "nora@acme.com";
  const key = 0x4a;
  const encoded = [
    key,
    ...[...email].map((character) => character.charCodeAt(0) ^ key),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  assert.deepEqual(
    extractPublishedEmails(`<a data-cfemail="${encoded}">protected</a>`, "acme.com"),
    [email],
  );
});

test("excludes role inboxes and addresses outside the company domain", () => {
  assert.deepEqual(
    extractPublishedEmails("info@acme.com help@other.com jane@sub.acme.com", "acme.com"),
    ["jane@sub.acme.com"],
  );
});

test("accepts only usable work addresses on the selected company domain", () => {
  assert.equal(isWorkEmailForDomain("nora@acme.com", "acme.com"), true);
  assert.equal(isWorkEmailForDomain("nora@other.com", "acme.com"), false);
  assert.equal(isWorkEmailForDomain("email_not_unlocked@acme.com", "acme.com"), false);
  assert.equal(isWorkEmailForDomain("info@acme.com", "acme.com"), false);
});

test("extracts addresses from data-user and data-domain attributes", () => {
  assert.deepEqual(
    extractPublishedEmails('<span data-user="nora" data-domain="acme.com"></span>', "acme.com"),
    ["nora@acme.com"],
  );
});

test("matches a published address to a selected person without guessing", () => {
  assert.equal(patternForPublishedEmail("nora.vale@acme.com", "Nora", "Vale"), "{f}.{l}");
  assert.equal(patternForPublishedEmail("nvale@acme.com", "Nora", "Vale"), "{fi}{l}");
  assert.equal(patternForPublishedEmail("nora.smith@acme.com", "Nora", "Vale"), undefined);
});

test("infers only clear separated domain patterns", () => {
  assert.equal(inferEmailPattern(["alex.park@acme.com"]), "{f}.{l}");
  assert.equal(inferEmailPattern(["a.park@acme.com"]), "{fi}.{l}");
  assert.equal(inferEmailPattern(["alexpark@acme.com"]), undefined);
});

test("translates Hunter patterns and builds a normalized candidate", () => {
  const pattern = patternFromHunter("{f}.{last}");
  assert.equal(pattern, "{fi}.{l}");
  assert.equal(buildEmailCandidate("Nora", "Vale", "www.acme.com", pattern), "n.vale@acme.com");
  assert.equal(
    buildEmailCandidate("José", "Núñez", "acme.com", "{f}.{l}"),
    "jose.nunez@acme.com",
  );
});

test("extracts names and decision-maker titles from site team sections", () => {
  assert.deepEqual(extractSitePeople("## Nora Vale\nChief Technology Officer\n\nJane Doe - CEO"), [
    { name: "Nora Vale", title: "Chief Technology Officer" },
    { name: "Jane Doe", title: "CEO" },
  ]);
  assert.deepEqual(extractSitePeople("## Our Team\nCEO"), []);
});
