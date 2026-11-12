import { z } from "zod";
export function dataControlError(error: unknown) {
  const message =
    error instanceof z.ZodError
      ? "Please provide valid text (1–12000 characters) and identifiers."
      : error instanceof Error
        ? error.message
        : "Could not update data";
  return Response.json(
    { error: message },
    {
      status: /not found/i.test(message)
        ? 404
        : /Cross-origin/.test(message)
          ? 403
          : 400,
    },
  );
}
export const editedText = z.string().trim().min(1).max(12000);
