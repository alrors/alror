import { route } from "@/lib/server/api/http";
import { logout } from "@/lib/server/auth/accounts";
import { clearSessionCookie, currentSid } from "@/lib/server/auth/session";

export const POST = route(async () => {
  await logout(await currentSid());
  await clearSessionCookie();
  return new Response(null, { status: 204 });
});
