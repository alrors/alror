import "server-only";
import type { SessionContext } from "@/lib/server/auth/accounts";

// The console's auth surface. Sessions live in Redis (src/lib/server/auth); this
// module keeps the import path the pages already use.
export { getSession, requireSession, requireCtx, safeNext } from "@/lib/server/auth/session";

export type ConsoleUser = SessionContext;
