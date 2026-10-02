import { readJson, route } from "@/lib/server/api/http";
import { SignupBody } from "@/lib/server/api/schemas";
import { loadSession, signup } from "@/lib/server/auth/accounts";
import { setSessionCookie } from "@/lib/server/auth/session";

// JSON counterpart of the /signup form (used by tests and scripted setups).
export const POST = route(async (req) => {
  const body = await readJson(req, SignupBody);
  const r = await signup({ email: body.email, password: body.password, name: body.name, orgName: body.org });
  await setSessionCookie(r.sid);
  const s = await loadSession(r.sid);
  return Response.json({ user: s?.user, org: s?.org, role: s?.role, first_run: r.firstRun }, { status: 201 });
});
