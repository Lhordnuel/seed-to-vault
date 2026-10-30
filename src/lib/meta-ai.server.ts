import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const MODEL_ID = "muse-spark-1.3";

export function getMetaAIModel() {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) return null;

  return createOpenAICompatible({
    name: "meta",
    baseURL: "https://api.meta.ai/v1",
    apiKey,
  }).chatModel(MODEL_ID);
}
