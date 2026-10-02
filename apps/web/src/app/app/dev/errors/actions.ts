"use server";

import { actionError, type ActionResult } from "@/lib/console/action-result";
import { requireSession } from "@/lib/console/auth";
import { ServiceUnavailableError } from "@/lib/server/errors";

/**
 * /dev/errors preview of a failing mutation. Server actions are reachable in any
 * build, so this refuses to do anything in production. It never writes data.
 */
export async function previewFailingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (process.env.NODE_ENV === "production") return { error: "Not available." };
  await requireSession();
  // Thrown, as when the session check itself hits the outage: useRetryableAction turns it into a retryable result.
  if (formData.get("mode") === "outage") throw new ServiceUnavailableError("database_unavailable");
  // Returned through actionError, as a caught unexpected error would be.
  return actionError(new Error("Preview: deliberate failure from /app/dev/errors/action-toast."), "Could not save the preview setting.");
}
