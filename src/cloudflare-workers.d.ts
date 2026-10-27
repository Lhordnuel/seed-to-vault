declare module "cloudflare:workers" {
  export const env: {
    AI: NonNullable<import("agents/models/ai-sdk").AISettings["binding"]>;
  };
}
