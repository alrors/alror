import { authorize, route } from "@/lib/server/api/http";
import { resolveIncident } from "@/lib/server/data/incidents";

type Ctx = { params: Promise<{ id: string }> };

/** Marks an open incident resolved by hand (409 when it is already resolved). */
export const POST = route<Ctx>(async (req, { params }) => {
  const { ctx } = await authorize(req, "deploy:write");
  const { id } = await params;
  return Response.json(await resolveIncident(ctx, id));
});
