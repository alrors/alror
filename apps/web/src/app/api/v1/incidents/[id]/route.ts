import { authorize, route } from "@/lib/server/api/http";
import { getIncident } from "@/lib/server/data/incidents";
import { notFound } from "@/lib/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** One incident with its ranked candidates, the automatic rollback decision and the raw alert. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { ctx } = await authorize(req, "deploy:read");
  const { id } = await params;
  const inc = await getIncident(ctx, id);
  if (!inc) throw notFound(`Incident ${id} not found.`);
  return Response.json(inc);
});
