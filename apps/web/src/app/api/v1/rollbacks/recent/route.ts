import { authorize, route } from "@/lib/server/api/http";
import { recentRollbacks } from "@/lib/server/data/deployments";
import { invalid } from "@/lib/server/errors";

export const GET = route(async (req) => {
  const { ctx } = await authorize(req, "deploy:read");
  const raw = req.nextUrl.searchParams.get("since");
  const since = raw ? new Date(raw) : new Date(Date.now() - 30 * 864e5);
  if (Number.isNaN(since.getTime())) throw invalid("since must be an RFC 3339 time.");
  return Response.json(await recentRollbacks(ctx, since));
});
