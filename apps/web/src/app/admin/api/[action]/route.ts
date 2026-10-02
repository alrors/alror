import type { NextRequest } from "next/server";
import { route } from "@/lib/server/api/http";
import { adminFromRequest } from "@/lib/server/admin/guard";
import { cancelJobAdmin, requeueJobAdmin } from "@/lib/server/admin/jobs";
import { deleteOrgAdmin, revokeAllKeys, revokeKeyAdmin, setOrgPlan } from "@/lib/server/admin/orgs";
import { adminKpis } from "@/lib/server/admin/overview";
import { removeFromOrgAdmin, resetPasswordAdmin, signOutEverywhere } from "@/lib/server/admin/users";
import { badRequest, notFound } from "@/lib/server/errors";

// JSON counterparts of the admin actions, for scripts and tests. Session cookie
// only; anyone who is not a platform admin gets a 404 like the pages.
//
//   GET  /admin/api/access     204 for a platform admin (the proxy's check), else 404
//   GET  /admin/api/summary
//   POST /admin/api/<action>  {org?, user?, key?, job?, plan?, confirm?}

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

async function body(req: NextRequest): Promise<Record<string, string>> {
  try {
    const text = await req.text();
    const raw = text.trim() ? (JSON.parse(text) as unknown) : {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")]));
  } catch {
    throw badRequest("Request body must be a JSON object.");
  }
}

export const GET = route<Ctx>(async (req, { params }) => {
  const admin = await adminFromRequest(req);
  const { action } = await params;
  // Used by src/proxy.ts to answer non-admins with a real 404 status.
  if (action === "access") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (action !== "summary") throw notFound();
  return Response.json(await adminKpis(admin));
});

export const POST = route<Ctx>(async (req, { params }) => {
  const admin = await adminFromRequest(req);
  const { action } = await params;
  const b = await body(req);
  switch (action) {
    case "org-plan":
      return Response.json(await setOrgPlan(admin, b.org ?? "", b.plan ?? ""));
    case "org-revoke-keys":
      return Response.json({ revoked: await revokeAllKeys(admin, b.org ?? "") });
    case "key-revoke":
      return Response.json({ prefix: await revokeKeyAdmin(admin, b.org ?? "", b.key ?? "") });
    case "org-delete":
      return Response.json(await deleteOrgAdmin(admin, b.org ?? "", b.confirm ?? ""));
    case "user-sign-out":
      return Response.json(await signOutEverywhere(admin, b.user ?? ""));
    case "user-reset-password":
      return Response.json(await resetPasswordAdmin(admin, b.user ?? ""), { headers: { "cache-control": "no-store" } });
    case "user-remove":
      return Response.json(await removeFromOrgAdmin(admin, b.user ?? "", b.org ?? ""));
    case "job-cancel":
      return Response.json(await cancelJobAdmin(admin, b.job ?? ""));
    case "job-requeue":
      return Response.json(await requeueJobAdmin(admin, b.job ?? ""));
    default:
      throw notFound();
  }
});
