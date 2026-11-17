import express, { type Request, type Response } from "express";
import { env } from "./env/index.js";
import {
  LinearWebhookClient,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_FIELD,
  type LinearWebhookPayload,
} from "@linear/sdk/webhooks";
import { sendLog } from "./services/discord.js";
import { wrapLogs } from "./lib/helpers.js";
import { ApiError } from "./lib/errors.js";
import { archiveIssue, type LinearRateLimits } from "./services/linear.js";
import type { Issue } from "@linear/sdk";

const app = express();
const webhookClient = new LinearWebhookClient(env.LINEAR_WEBHOOK_SECRET);

app.post(
  "/webhooks/linear",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      const rawBody = req.body as Buffer;
      const signature = req.headers[LINEAR_WEBHOOK_SIGNATURE_HEADER] as string;
      const timestamp = JSON.parse(rawBody.toString())[LINEAR_WEBHOOK_TS_FIELD];

      let payload: undefined | LinearWebhookPayload;

      await wrapLogs(
        () => {
          payload = webhookClient.parseData(rawBody, signature, timestamp);
        },
        "Webhook verification error",
        { statusCode: 401 },
      );

      if (!payload) throw new ApiError("Webhook verification error", 401);

      let result:
        | undefined
        | {
            actionPerformed: boolean;
            issue: Issue;
            rateLimits: LinearRateLimits;
          };

      await wrapLogs(async () => {
        if (
          payload &&
          payload.type === "Issue" &&
          payload.action === "update"
        ) {
          result = await archiveIssue(payload.data.id);
        }
      }, "Issue archive error");

      await wrapLogs(async () => {
        if (result && result.actionPerformed) {
          const message = `Issue **${result.issue.identifier} ${result.issue.title}** archived successfully!\n\n**Rate Limits**\nComplexity Cost: **${result.rateLimits.complexityCost}**\nComplexity Remaining: **${result.rateLimits.complexityRemaining}**\nRequests Remaining: **${result.rateLimits.requestsRemaining}**`;
          const logSent = await sendLog({ message, type: "success" });
          if (logSent.error) throw new Error("Failed to send success message.");
        }
      }, "Failed to send success message");

      res.status(201).send("Received");
    } catch (error) {
      console.error("Unknown workflow error:", error);
      const statusCode = error instanceof ApiError ? error.statusCode : 500;
      res.status(statusCode).json({ error: JSON.stringify(error) });
    }
  },
);

app.use(express.json());

app.get("/health", (_: Request, res: Response) => {
  res.json({ status: "ok", message: "Linear Auto Archive server is running." });
});

app.listen(env.PORT, () => {
  console.log(`Server listening on PORT ${env.PORT}`);
});
