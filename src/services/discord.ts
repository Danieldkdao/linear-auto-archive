import z from "zod";
import { env } from "../env/index.js";
import { format } from "date-fns";

const logOptionsSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  type: z.enum(["success", "warning", "error", "info"]),
});
type LogOptionsSchema = z.infer<typeof logOptionsSchema>;
type LogOptionsType = LogOptionsSchema["type"];

const emojiMap: Record<LogOptionsType, string> = {
  success: "✅",
  warning: "⚠️",
  error: "🛑",
  info: "ℹ️",
};

const getCurrentTimestamp = () => {
  return format(new Date(), "PPpp");
};

export const formatLogType = (type: LogOptionsType) => {
  switch (type) {
    case "error":
      return "Error";
    case "info":
      return "Info";
    case "success":
      return "Success";
    case "warning":
      return "Warning";
    default:
      throw new Error(`Unknown log type: ${type satisfies never}`);
  }
};

export const sendLog = async (unsafeData: LogOptionsSchema) => {
  try {
    const { data, success } = logOptionsSchema.safeParse(unsafeData);
    if (!success) {
      await sendMessage(
        `**${emojiMap.error} Error ${getCurrentTimestamp()}**\nFailed to validate the following input: ${JSON.stringify(unsafeData)}`,
      );
      throw new Error(
        `Failed to validate the following input: ${JSON.stringify(unsafeData)}`,
      );
    }

    const firstPart = `${emojiMap[data.type]}  **${formatLogType(data.type)} • ${getCurrentTimestamp()}**`;
    const message = `${firstPart}\n${data.message}`;

    const response = await sendMessage(message);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Discord webhook failed: ${errorBody}`);
    }

    return {
      error: false,
      message: "Log sent successfully!",
    };
  } catch (error) {
    console.error("Error sending log:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to send log.";
    return {
      error: true,
      message: errorMessage,
    };
  }
};

const sendMessage = async (message: string) => {
  return fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: message,
    }),
  });
};
