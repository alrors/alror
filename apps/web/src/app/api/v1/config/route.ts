import { authenticate, authorize, readJson, route } from "@/lib/server/api/http";
import { ConfigBody } from "@/lib/server/api/schemas";
import { getConfig, putConfig } from "@/lib/server/data/config";

export const GET = route(async (req) => {
  const { ctx } = await authorize(req, "deploy:read");
  return Response.json(await getConfig(ctx));
});

export const PUT = route(async (req) => {
  // putConfig enforces owner/admin session or the config:write scope.
  const { ctx } = await authenticate(req);
  const body = await readJson(req, ConfigBody);
  return Response.json(await putConfig(ctx, body));
});
