import type { NextRequest } from "next/server";
import { anchorNow } from "@/lib/console/analytics";
import { listDeployments } from "@/lib/console/data";
import { selectedEnvironment } from "@/lib/console/environments";
import { applyBase, durationMs, matchesStatus, parseFilters, sortDeployments } from "../filters";

/** CSV of the deployments list with the same filters and sort as /app/deployments (all pages). */
export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const [deps, env] = await Promise.all([listDeployments(), selectedEnvironment(sp.environment)]);
  const now = anchorNow(deps);
  const services = [...new Set(deps.map((d) => d.service))];
  const f = parseFilters(sp, services, env);
  const rows = sortDeployments(
    applyBase(deps, f).filter((d) => matchesStatus(d, f.status)),
    f.sort,
    now,
  );

  const header = ["id", "service", "ref", "image", "environment", "source", "status", "risk_score", "risk_level", "ai_authored", "traffic_pct", "stages", "duration_s", "created_at", "updated_at", "reason"];
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheets from evaluating cells as formulas
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const d of rows) {
    const traffic = d.status === "promoted" ? 100 : d.status === "rolling" ? d.weight : 0;
    lines.push(
      [
        d.id,
        d.service,
        d.ref ?? "",
        d.image,
        d.environment ?? "production",
        d.source ?? "cli",
        d.status,
        d.risk?.score ?? 0,
        d.risk?.level ?? "",
        d.risk?.ai_authored ? "yes" : "no",
        traffic,
        (d.plan?.steps ?? []).map((s) => s.weight).join(" > "),
        Math.round(durationMs(d, now) / 1000),
        d.created_at,
        d.updated_at,
        d.reason ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }
  const stamp = new Date(now).toISOString().slice(0, 10);
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="alror-deployments-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
