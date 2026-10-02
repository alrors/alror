import { route } from "@/lib/server/api/http";
import { loadSession } from "@/lib/server/auth/accounts";
import { currentSid } from "@/lib/server/auth/session";
import { unauthorized } from "@/lib/server/errors";
import { listOrgsForUser } from "@/lib/server/data/orgs";

export const GET = route(async () => {
  const s = await loadSession(await currentSid());
  if (!s) throw unauthorized();
  const orgs = await listOrgsForUser(s.user.id);
  return Response.json({ user: s.user, org: s.org, role: s.role, orgs: orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name, role: o.role })) });
});
