import { sendLog } from "../services/discord.js";
import { ApiError } from "./errors.js";

export const wrapLogs = async (
  action: () => unknown | Promise<unknown>,
  defErrorMessage: string,
  options: { statusCode: number } = { statusCode: 500 },
) => {
  const { statusCode: defaultStatusCode } = options;
  const errorPrefix = `${defErrorMessage}:`;
  try {
    await action();
  } catch (error) {
    console.error(errorPrefix, error);
    const errorMessage =
      error instanceof Error ? error.message : defErrorMessage;
    const statusCode =
      error instanceof ApiError ? error.statusCode : defaultStatusCode;
    await sendLog({ message: errorMessage, type: "error" });
    throw new ApiError(errorMessage, statusCode);
  }
};
