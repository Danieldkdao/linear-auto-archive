import { LinearClient } from "@linear/sdk";
import { env } from "../env/index.js";
import { ApiError } from "../lib/errors.js";

let rateLimits = {
  complexityCost: 0,
  complexityRemaining: 0,
  requestsRemaining: 0,
};

export type LinearRateLimits = typeof rateLimits;

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  if (url.includes("api.linear.app/graphql")) {
    rateLimits = {
      complexityCost: Number(response.headers.get("X-Complexity") ?? 0),
      complexityRemaining: Number(
        response.headers.get("X-RateLimit-Complexity-Remaining") ?? 0,
      ),
      requestsRemaining: Number(
        response.headers.get("X-RateLimit-Requests-Remaining") ?? 0,
      ),
    };
  }

  return response;
};

const linearClient = new LinearClient({
  apiKey: env.LINEAR_API_KEY,
});

export const archiveIssue = async (issueId: string) => {
  const existingIssue = await linearClient.issue(issueId);
  if (!existingIssue || existingIssue.id !== issueId)
    throw new ApiError("Issue not found", 404);

  if (!Boolean(existingIssue.completedAt)) {
    return {
      actionPerformed: false,
      issue: existingIssue,
      rateLimits,
    };
  }

  const action = await existingIssue.archive();
  if (!action.success) throw new ApiError("Failed to archive issue", 500);
  return {
    actionPerformed: true,
    issue: existingIssue,
    rateLimits,
  };
};
