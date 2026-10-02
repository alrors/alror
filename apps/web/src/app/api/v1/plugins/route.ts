import { authorize, route } from "@/lib/server/api/http";
import { apiPlugins } from "@/lib/server/data/plugins";

/** The org's installed marketplace plugins (non-secret settings only), its metrics provider and its deploy targets. */
export const GET = route(async (req) => {
  const { ctx } = await authorize(req, "deploy:read");
  return Response.json(await apiPlugins(ctx));
});
