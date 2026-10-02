import { setTimeout } from "node:timers/promises";
import { closeDb } from "../src/lib/server/db";
import { configStatus } from "../src/lib/server/github/config";
import { runWorkerOnce } from "../src/lib/server/github/worker";

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
async function main() {
  const status = configStatus();
  if (!status.configured) throw new Error(`Missing server configuration: ${status.missing.join(", ")}`);
  console.log("[alror:github] durable worker started");
  while (!stopping) {
    try { if (!(await runWorkerOnce())) await setTimeout(2000); }
    catch { console.error("[alror:github] inbox unavailable; retrying shortly"); await setTimeout(5000); }
  }
}
main().catch((e: Error) => { console.error(e.message); process.exitCode = 1; }).finally(closeDb);
