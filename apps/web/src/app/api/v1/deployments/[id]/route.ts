import { authorize, parse, readJson, route, sourceHint } from "@/lib/server/api/http";
import { DeploymentBody } from "@/lib/server/api/schemas";
import { mustGetDeployment, upsertDeployment } from "@/lib/server/data/deployments";
import { invalid } from "@/lib/server/errors";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { ctx } = await authorize(req, "deploy:read");
  const { id } = await params;
  return Response.json(await mustGetDeployment(ctx, id));
});

export const PUT = route<Ctx>(async (req, { params }) => {
  const { ctx } = await authorize(req, "deploy:write");
  const { id } = await params;
  const raw = (await readJson(req, DeploymentBody.partial({ id: true }).loose())) as Record<string, unknown>;
  if (raw.id !== undefined && raw.id !== id) throw invalid("Body id does not match the URL.");
  const body = parse(DeploymentBody, { ...raw, id });
  // PUT updates an existing deployment only (404 otherwise; clients then POST).
  const { deployment } = await upsertDeployment(ctx, body, { mustExist: true, sourceHint: sourceHint(req) });
  return Response.json(deployment);
});
