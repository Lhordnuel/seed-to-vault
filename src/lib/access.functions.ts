import { createServerFn } from "@tanstack/react-start";

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
    return { ok: diff === 0 };
  });
