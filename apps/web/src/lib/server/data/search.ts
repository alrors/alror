import "server-only";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { OrgCtx } from "../context";
import { db } from "../db";
import { deployments, services } from "../db/schema";

export type SearchResult = {
  services: { name: string; target: string; archived: boolean }[];
  deployments: { id: string; service: string; ref: string; image: string; status: string; created_at: string }[];
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Command palette search over the org's services (by name) and deployments (id, service, ref, image). */
export async function searchConsole(ctx: OrgCtx, query: string, limit = 6): Promise<SearchResult> {
  const q = query.trim().slice(0, 100);
  if (!q) return { services: [], deployments: [] };
  const pat = `%${escapeLike(q)}%`;
  const [svc, deps] = await Promise.all([
    db
      .select({ name: services.name, target: services.target, archivedAt: services.archivedAt })
      .from(services)
      .where(and(eq(services.orgId, ctx.orgId), ilike(services.name, pat)))
      .orderBy(sql`${services.archivedAt} is not null`, asc(services.name))
      .limit(limit),
    db
      .select({
        id: deployments.id,
        service: deployments.service,
        ref: deployments.ref,
        image: deployments.image,
        status: deployments.status,
        createdAt: deployments.createdAt,
      })
      .from(deployments)
      .where(
        and(
          eq(deployments.orgId, ctx.orgId),
          or(ilike(deployments.id, pat), ilike(deployments.service, pat), ilike(deployments.ref, pat), ilike(deployments.image, pat)),
        ),
      )
      .orderBy(desc(deployments.createdAt))
      .limit(limit + 2),
  ]);
  return {
    services: svc.map((s) => ({ name: s.name, target: s.target, archived: Boolean(s.archivedAt) })),
    deployments: deps.map((d) => ({ id: d.id, service: d.service, ref: d.ref, image: d.image, status: d.status, created_at: d.createdAt.toISOString() })),
  };
}
