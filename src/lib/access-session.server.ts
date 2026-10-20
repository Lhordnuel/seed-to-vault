import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "startup_scout_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function sessionSignature(expiresAt: number, password: string): string {
  return createHmac("sha256", password)
    .update(`startup-scout:${expiresAt}`)
    .digest("hex");
}

export function createAccessSession(password: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return `${expiresAt}.${sessionSignature(expiresAt, password)}`;
}

export function getAccessSessionCookieName(): string {
  return COOKIE_NAME;
}

export function hasValidAccessSession(request: Request): boolean {
  const expectedPassword = process.env.APP_ACCESS_PASSWORD;
  if (!expectedPassword) return false;

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!cookie || cookie.length > 128) return false;

  const [expiresAtText, signature, ...rest] = cookie.split(".");
  if (!expiresAtText || !signature || rest.length > 0) return false;
  const expiresAt = Number(expiresAtText);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + SESSION_SECONDS) {
    return false;
  }

  const expected = Buffer.from(sessionSignature(expiresAt, expectedPassword));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
