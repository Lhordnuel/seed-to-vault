import { createAI } from "agents/models/ai-sdk";
import { env } from "cloudflare:workers";

const MODEL_ID = "@cf/zai-org/glm-4.7-flash";

export function getWorkersAIModel() {
  const binding = env.AI;
  if (!binding) return null;
  return createAI({ binding })(MODEL_ID);
}
