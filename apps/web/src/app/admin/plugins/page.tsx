import type { Metadata } from "next";
import { AdminHeader, Kpi, shortDate, tableCell, tableHead } from "@/components/admin/kit";
import { BarList } from "@/components/console/charts";
import { Card, EmptyState, Pill } from "@/components/console/primitives";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { pluginStats } from "@/lib/server/admin/insights";
import { CATALOG, categoryLabel } from "@/lib/server/marketplace/catalog";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Plugins" };

export default async function AdminPlugins() {
  const admin = await requirePlatformAdmin();
  const stats = await pluginStats(admin);
  const installs = new Map(stats.installs.map((s) => [s.plugin_id, s]));
  const votes = new Map(stats.votes.map((v) => [v.plugin_id, v]));
  const installable = CATALOG.filter((p) => p.kind === "installable");
  const planned = CATALOG.filter((p) => p.kind === "planned").sort((a, b) => (votes.get(b.id)?.votes ?? 0) - (votes.get(a.id)?.votes ?? 0));
  const known = new Set(CATALOG.map((p) => p.id));
  const unknown = stats.installs.filter((s) => !known.has(s.plugin_id));
  const totalInstalls = stats.installs.reduce((s, x) => s + x.installs, 0);
  const totalVotes = stats.votes.reduce((s, x) => s + x.votes, 0);
  const orgsWithPlugins = new Set(stats.installs.flatMap((s) => s.orgs)).size;

  if (!stats.ready) {
    return (
      <div className="con-fade-up">
        <AdminHeader title="Plugins" description="Marketplace adoption across organizations." />
        <Card>
          <EmptyState title="Marketplace tables are not migrated yet">Run `npm run db:migrate` to create org_plugins and plugin_votes; installs and votes appear here afterwards.</EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="con-fade-up space-y-4">
      <AdminHeader title="Plugins" description="Marketplace installs per plugin across every org, and votes for planned plugins. Read-only." />
      <div className="con-stagger grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Installs" value={totalInstalls} />
        <Kpi label="Orgs with plugins" value={orgsWithPlugins} />
        <Kpi label="Installable plugins" value={installable.length} />
        <Kpi label="Votes for planned" value={totalVotes} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Installs per plugin" description="Installed in org_plugins; enabled counts exclude disabled installs." flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-con-line">
                  <th className={tableHead}>Plugin</th>
                  <th className={tableHead}>Category</th>
                  <th className={cn(tableHead, "text-right")}>Installs</th>
                  <th className={cn(tableHead, "text-right")}>Enabled</th>
                  <th className={tableHead}>Orgs</th>
                  <th className={tableHead}>Last install</th>
                </tr>
              </thead>
              <tbody>
                {[...installable.map((p) => ({ id: p.id, name: p.name, cat: categoryLabel(p.category), stage: p.stage })), ...unknown.map((u) => ({ id: u.plugin_id, name: u.plugin_id, cat: "Unknown", stage: "removed" }))]
                  .sort((a, b) => (installs.get(b.id)?.installs ?? 0) - (installs.get(a.id)?.installs ?? 0))
                  .map((p) => {
                    const s = installs.get(p.id);
                    return (
                      <tr key={p.id} className="border-b border-con-line last:border-0">
                        <td className={tableCell}>
                          <span className="font-medium text-con-fg">{p.name}</span>
                          {p.stage !== "ready" && <Pill className="ml-2">{p.stage}</Pill>}
                        </td>
                        <td className={cn(tableCell, "text-con-fg2")}>{p.cat}</td>
                        <td className={cn(tableCell, "text-right tabular-nums")}>{s?.installs ?? 0}</td>
                        <td className={cn(tableCell, "text-right tabular-nums text-con-fg2")}>{s?.enabled ?? 0}</td>
                        <td className={cn(tableCell, "max-w-[220px] truncate text-con-fg2")} title={s?.orgs.join(", ")}>
                          {s?.orgs.length ? s.orgs.join(", ") : "–"}
                        </td>
                        <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{s?.last_installed ? shortDate(s.last_installed) : "–"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Votes for planned plugins" description="One vote per user per org. Helps decide what to build next.">
          {planned.length === 0 ? (
            <EmptyState title="No planned plugins in the catalog" />
          ) : (
            <BarList
              emptyLabel="No votes yet"
              items={planned.map((p) => ({
                label: p.name,
                value: votes.get(p.id)?.votes ?? 0,
                display: `${votes.get(p.id)?.votes ?? 0} vote${(votes.get(p.id)?.votes ?? 0) === 1 ? "" : "s"}${votes.get(p.id) ? ` · ${votes.get(p.id)!.orgs} org${votes.get(p.id)!.orgs === 1 ? "" : "s"}` : ""}`,
              }))}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
