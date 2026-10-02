import { authorize, route } from "@/lib/server/api/http";

export const GET = route(async (req) => {
  const { ctx, org } = await authorize(req, null);
  return Response.json({
    org,
    actor: { type: ctx.actor.type, id: ctx.actor.id, label: ctx.actor.label, ...(ctx.actor.role ? { role: ctx.actor.role } : {}) },
    scopes: ctx.actor.scopes,
  });
});
