import { createFileRoute } from "@tanstack/react-router";
import {
  ACCESS_SESSION_MAX_AGE,
  createAccessSession,
  getAccessSessionCookieName,
  hasValidAccessSession,
} from "@/lib/access-session.server";

export const Route = createFileRoute("/api/session")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        new Response(null, {
          status: hasValidAccessSession(request) ? 204 : 401,
          headers: { "Cache-Control": "no-store" },
        }),
      POST: async ({ request }) => {
        const errorResponse = (error: string, status: number) =>
          Response.json(
            { error },
            { status, headers: { "Cache-Control": "no-store" } },
          );

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Invalid login request.", 400);
        }

        if (
          !body ||
          typeof body !== "object" ||
          !("password" in body) ||
          typeof body.password !== "string"
        ) {
          return errorResponse("Invalid login request.", 400);
        }

        const expected = process.env.APP_ACCESS_PASSWORD;
        if (!expected) {
          console.error("[Access] APP_ACCESS_PASSWORD is not configured.");
          return errorResponse(
            "App access is not configured. Contact the app administrator.",
            500,
          );
        }

        const { password } = body;
        if (password.length !== expected.length) {
          return errorResponse("Incorrect password.", 401);
        }

        let diff = 0;
        for (let i = 0; i < password.length; i++) {
          diff |= password.charCodeAt(i) ^ expected.charCodeAt(i);
        }
        if (diff !== 0) {
          return errorResponse("Incorrect password.", 401);
        }

        const secure = new URL(request.url).protocol === "https:";
        const cookie = [
          `${getAccessSessionCookieName()}=${createAccessSession(expected)}`,
          "HttpOnly",
          "SameSite=Strict",
          "Path=/",
          `Max-Age=${ACCESS_SESSION_MAX_AGE}`,
          ...(secure ? ["Secure"] : []),
        ].join("; ");

        return Response.json(
          { ok: true },
          { headers: { "Cache-Control": "no-store", "Set-Cookie": cookie } },
        );
      },
    },
  },
});
