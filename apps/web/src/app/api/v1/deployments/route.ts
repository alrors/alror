import { authorize, readJson, route, sourceHint } from "@/lib/server/api/http";
import { DeploymentBody } from "@/lib/server/api/schemas";
import { STATUSES, type DeploymentStatus } from "@/lib/server/db/schema";
import { listDeployments, upsertDeployment } from "@/lib/server/data/deployments";
import { invalid } from "@/lib/server/errors";

const MAX_LIMIT = 1000;

export const GET = route(async (req) => {
  const { ctx } = await authorize(req, "deploy:read");
  const sp = req.nextUrl.searchParams;
  const limitRaw = sp.get("limit");
  const limit = limitRaw === null || limitRaw === "" ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw invalid(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
  const status = sp.get("status") || undefined;
  if (status && !STATUSES.includes(status as DeploymentStatus)) throw invalid(`status must be one of ${STATUSES.join(", ")}.`);
  const deployments = await listDeployments(
    ctx,
    { status: status as DeploymentStatus | undefined, service: sp.get("service") || undefined, environment: sp.get("environment") || undefined },
    { limit, before: sp.get("before") || undefined },
  );
  return Response.json(deployments);
});

export const POST = route(async (req) => {
  const { ctx } = await authorize(req, "deploy:write");
  const body = await readJson(req, DeploymentBody);
  const { deployment } = await upsertDeployment(ctx, body, { sourceHint: sourceHint(req) });
  return Response.json(deployment, { status: 201 });
});
