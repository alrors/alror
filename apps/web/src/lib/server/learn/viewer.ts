import "server-only";
import { isPlatformAdmin } from "../admin/access";
import { getSession } from "../auth/session";

/** Whether the viewer may see drafts on /learn. A session outage just means "no". */
export async function viewerIsAdmin(): Promise<boolean> {
  try {
    const s = await getSession();
    return isPlatformAdmin(s?.user.email);
  } catch {
    return false;
  }
}
