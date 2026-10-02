import { authorize, readJson, route } from "@/lib/server/api/http";
import { ClaimBody } from "@/lib/server/api/schemas";
import { claimJobLongPoll } from "@/lib/server/data/jobs";

// Long-poll used by `alror runner`: waits up to 25 s for a job (Redis BRPOP signal + SKIP LOCKED claim).
export const maxDuration = 60;

export const POST = route(async (req) => {
  const { ctx } = await authorize(req, "jobs:run");
  const body = await readJson(req, ClaimBody);
  const job = await claimJobLongPoll(ctx, body.worker ?? body.runner ?? "runner", { timeoutMs: (body.wait ?? 25) * 1000, signal: req.signal });
  if (!job) return new Response(null, { status: 204 });
  return Response.json(job);
});
