import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie } from "@tanstack/react-start/server";
import { createAccessSession, getAccessSessionCookieName } from "@/lib/access-session.server";

export const verifyAccessPassword = createServerFn({ method: "POST" })
  .inputValidator((input: { password: string }) => {
    if (!input || typeof input.password !== "string") {
      throw new Error("Invalid input");
    }
    return { password: input.password };
  })
  .handler(async ({ data }) => {
    const expected = process.env.APP_ACCESS_PASSWORD;
    if (!expected) {
      return { ok: false, error: "Access password not configured" };
    }
    // constant-time-ish compare
    const a = data.password;
    const b = expected;
    if (a.length !== b.length) return { ok: false };
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    const ok = diff === 0;
    if (ok) {
      const request = getRequest();
      setCookie(getAccessSessionCookieName(), createAccessSession(expected), {
        httpOnly: true,
        secure: request?.url.startsWith("https://") ?? process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    return { ok };
  });
