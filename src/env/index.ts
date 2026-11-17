import { createEnv } from "@t3-oss/env-core";
import z from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    PORT: z.coerce.number().default(12480),
    LINEAR_API_KEY: z.string().min(1),
    LINEAR_WEBHOOK_SECRET: z.string().min(1),
    DISCORD_WEBHOOK_URL: z.url().min(1),
  },
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
});
