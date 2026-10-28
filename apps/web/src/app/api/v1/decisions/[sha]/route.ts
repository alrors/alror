import { authorize, route } from "@/lib/server/api/http";
import { getCommitDecision } from "@/lib/server/decision/stored";

type Ctx = { params: Promise<{ sha: string }> };

/** The stored PR decision (shared-rules risk, rollout plan and gate outcome) for a commit. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { ctx } = await authorize(req, "deploy:read");
  const { sha } = await params;
  return Response.json(await getCommitDecision(ctx, sha));
});
