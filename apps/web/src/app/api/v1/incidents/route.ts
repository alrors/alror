import { authorize, parse, route } from "@/lib/server/api/http";
import { IncidentStatusQuery } from "@/lib/server/api/schemas";
import { listIncidents } from "@/lib/server/data/incidents";
import { invalid } from "@/lib/server/errors";

/** Incidents newest first (by started_at), without raw payloads. `?status=open|resolved&limit=50&page=1`. */
export const GET = route(async (req) => {
  const { ctx } = await authorize(req, "deploy:read");
  const sp = req.nextUrl.searchParams;
  const status = parse(IncidentStatusQuery, sp.get("status") || undefined);
  const limit = Number(sp.get("limit") ?? 50);
  const page = Number(sp.get("page") ?? 1);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw invalid("limit must be 1 to 200.");
  if (!Number.isInteger(page) || page < 1) throw invalid("page must be 1 or more.");
  const r = await listIncidents(ctx, { status, per: limit, page });
  return Response.json(r.items);
});
