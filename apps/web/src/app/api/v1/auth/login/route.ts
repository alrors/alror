import { readJson, route } from "@/lib/server/api/http";
import { LoginBody } from "@/lib/server/api/schemas";
import { loadSession, login } from "@/lib/server/auth/accounts";
import { clientIp, setSessionCookie } from "@/lib/server/auth/session";

// JSON counterpart of the /login form (used by tests and scripted setups).
export const POST = route(async (req) => {
  const body = await readJson(req, LoginBody);
  const r = await login({ email: body.email, password: body.password, ip: await clientIp() });
  await setSessionCookie(r.sid);
  const s = await loadSession(r.sid);
  return Response.json({ user: s?.user, org: s?.org, role: s?.role });
});
