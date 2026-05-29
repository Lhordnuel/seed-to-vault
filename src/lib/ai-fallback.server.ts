import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { LanguageModelV2 } from "@ai-sdk/provider";

/**
 * AWS Bedrock fallback. Activates automatically when the Lovable AI Gateway
 * throws a credit-exhausted (402) or rate-limit (429) error.
 *
 * Auth uses the long-term Bedrock API key (bearer auth), not AWS SigV4.
 * Default region: us-west-2. Default model: Claude 3.5 Haiku (cheap + fast).
 */
const DEFAULT_REGION = "us-west-2";
const DEFAULT_MODEL = "anthropic.claude-3-5-haiku-20241022-v1:0";

export function getBedrockModel(): LanguageModelV2 | null {
  const apiKey = process.env.BEDROCK_API_KEY;
  if (!apiKey) return null;
  const bedrock = createAmazonBedrock({
    apiKey,
    region: process.env.BEDROCK_REGION || DEFAULT_REGION,
  });
  return bedrock(process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL);
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
  primary: LanguageModelV2,
  fallback: LanguageModelV2 | null,
): LanguageModelV2 {
  if (!fallback) return primary;
  return new Proxy(primary, {
    get(target, prop, receiver) {
      if (prop === "doGenerate") {
        return async (opts: Parameters<LanguageModelV2["doGenerate"]>[0]) => {
          try {
            return await target.doGenerate(opts);
          } catch (e) {
            if (isFallbackError(e)) {
              console.warn("[ai-fallback] Lovable AI failed, retrying on Bedrock:", (e as Error).message);
              return fallback.doGenerate(opts);
            }
            throw e;
          }
        };
      }
      if (prop === "doStream") {
        return async (opts: Parameters<LanguageModelV2["doStream"]>[0]) => {
          try {
            return await target.doStream(opts);
          } catch (e) {
            if (isFallbackError(e)) {
              console.warn("[ai-fallback] Lovable AI failed, retrying on Bedrock:", (e as Error).message);
              return fallback.doStream(opts);
            }
            throw e;
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
