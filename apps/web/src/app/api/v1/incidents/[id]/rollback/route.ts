import { authorize, readJson, route } from "@/lib/server/api/http";
import { IncidentRollbackBody } from "@/lib/server/api/schemas";
import { rollbackFromIncident } from "@/lib/server/data/incidents";

type Ctx = { params: Promise<{ id: string }> };

/** Queues a rollback job for one of the incident's candidates; an alror runner executes it. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { ctx } = await authorize(req, "deploy:write");
  const { id } = await params;
  const body = await readJson(req, IncidentRollbackBody);
  return Response.json(await rollbackFromIncident(ctx, id, body.deployment_id), { status: 201 });
});
