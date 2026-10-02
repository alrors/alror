// Result shape shared by console server actions used with useActionState (safe for client imports).
// `retryable` marks failures worth retrying as-is (an outage or an unexpected
// error), as opposed to validation or permission errors; toasts offer "Retry".
export type ActionResult = { ok?: boolean; error?: string; message?: string; retryable?: boolean } | undefined;
