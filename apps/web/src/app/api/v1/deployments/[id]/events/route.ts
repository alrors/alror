import { authorize, readJson, route } from "@/lib/server/api/http";
import { EventBody } from "@/lib/server/api/schemas";
import { appendEvent, listEvents } from "@/lib/server/data/deployments";
import { notFound } from "@/lib/server/errors";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { ctx } = await authorize(req, "deploy:read");
  const { id } = await params;
  const events = await listEvents(ctx, id);
  if (!events) throw notFound(`Deployment ${id} not found.`);
  return Response.json(events);
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { ctx } = await authorize(req, "deploy:write");
  const { id } = await params;
  const body = await readJson(req, EventBody);
  const event = await appendEvent(ctx, id, body);
  return Response.json(event, { status: 201 });
});
