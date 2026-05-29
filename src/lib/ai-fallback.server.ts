import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { LanguageModel } from "ai";

/**
 * AWS Bedrock fallback. Activates automatically when the Lovable AI Gateway
 * throws a credit-exhausted (402) or rate-limit (429) error.
 *
 * Auth uses the long-term Bedrock API key (bearer auth), not AWS SigV4.
 * Default region: us-west-2. Default model: Claude 3.5 Haiku (cheap + fast).
 */
const DEFAULT_REGION = "us-west-2";
const DEFAULT_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const DEFAULT_OPUS_MODEL = "us.anthropic.claude-opus-4-20250514-v1:0";

function bedrock() {
  const apiKey = process.env.BEDROCK_API_KEY;
  if (!apiKey) return null;
  return createAmazonBedrock({
    apiKey,
    region: process.env.BEDROCK_REGION || DEFAULT_REGION,
  });
}

export function getBedrockModel(): LanguageModel | null {
  const b = bedrock();
  if (!b) return null;
  return b(process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL);
}

/** Claude Opus on Bedrock — used for the email-sourcing reasoning tool. */
export function getBedrockOpusModel(): LanguageModel | null {
  const b = bedrock();
  if (!b) return null;
  return b(process.env.BEDROCK_OPUS_MODEL_ID || DEFAULT_OPUS_MODEL);
}

function isFallbackError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { statusCode?: number; status?: number; message?: string };
  const code = e.statusCode ?? e.status;
  if (code === 402 || code === 429) return true;
  const msg = e.message?.toLowerCase() ?? "";
  return (
    msg.includes("credit") ||
    msg.includes("payment required") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  );
}

/**
 * Returns a model that tries `primary` first, and on credit/rate errors
 * thrown synchronously (before the stream starts), retries with `fallback`.
 */
export function withFallback(
  primary: LanguageModel,
  fallback: LanguageModel | null,
): LanguageModel {
  if (!fallback) return primary;
  // Use loose typing internally: V2 and V3 share the doGenerate/doStream shape
  // that streamText invokes; the union type just complicates static checking.
  const p = primary as unknown as { doGenerate: Function; doStream: Function };
  const f = fallback as unknown as { doGenerate: Function; doStream: Function };
  return new Proxy(primary as object, {
    get(target, prop, receiver) {
      if (prop === "doGenerate") {
        return async (opts: unknown) => {
          try {
            return await p.doGenerate(opts);
          } catch (e) {
            if (isFallbackError(e)) {
              console.warn(
                "[ai-fallback] Lovable AI failed, retrying on Bedrock:",
                (e as Error).message,
              );
              return f.doGenerate(opts);
            }
            throw e;
          }
        };
      }
      if (prop === "doStream") {
        return async (opts: unknown) => {
          try {
            return await p.doStream(opts);
          } catch (e) {
            if (isFallbackError(e)) {
              console.warn(
                "[ai-fallback] Lovable AI failed, retrying on Bedrock:",
                (e as Error).message,
              );
              return f.doStream(opts);
            }
            throw e;
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as LanguageModel;
}
