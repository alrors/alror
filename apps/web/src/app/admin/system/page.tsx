import type { Metadata } from "next";
import { AdminHeader, bytes, tableCell, tableHead } from "@/components/admin/kit";
import { Card, Field, Pill } from "@/components/console/primitives";
import { dateTime, span } from "@/lib/console/format";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { appVersion, envChecks, migrationStatus, postgresInfo, redisInfo, tableStats } from "@/lib/server/admin/system";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "System" };

const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;

export default async function AdminSystem() {
  const admin = await requirePlatformAdmin();
  const [pg, migrations, tables, rd, app] = await Promise.all([
    postgresInfo(admin),
    migrationStatus(admin),
    tableStats(admin),
    redisInfo(admin),
    appVersion(admin),
  ]);
  const checks = envChecks(admin);
  const pending = migrations.items.filter((m) => m.state !== "applied").length;
  const totalRows = tables.reduce((s, t) => s + t.rows, 0);

  return (
    <div className="con-fade-up space-y-4">
      <AdminHeader title="System" description="Live health of this instance: database, migrations, Redis, the app build and configuration." />

      <div className="con-stagger grid gap-4 lg:grid-cols-3">
        <Card title="Postgres" aside={<Pill tone="good">Connected</Pill>}>
          <dl className="divide-y divide-con-line">
            <Field label="Version">{pg.version}</Field>
            <Field label="Database">{pg.database}</Field>
            <Field label="Size">{bytes(pg.size_bytes)}</Field>
            <Field label="Connections">{pg.connections}</Field>
            <Field label="Query latency">{ms(pg.latency_ms)}</Field>
            <Field label="Up since">{pg.started_at ? dateTime(pg.started_at) : "–"}</Field>
          </dl>
        </Card>

        <Card title="Redis" aside={rd.ok ? <Pill tone="good">PONG</Pill> : <Pill tone="bad">Unreachable</Pill>}>
          {rd.ok ? (
            <dl className="divide-y divide-con-line">
              <Field label="Version">{rd.version}</Field>
              <Field label="Ping latency">{ms(rd.latency_ms)}</Field>
              <Field label="Memory used">{rd.used_memory}</Field>
              <Field label="Peak memory">{rd.peak_memory}</Field>
              <Field label="Max memory">{rd.maxmemory === "0B" ? "no limit" : rd.maxmemory}</Field>
              <Field label="Keys">{rd.keys}</Field>
              <Field label="Sessions">{rd.sessions}</Field>
              <Field label="Uptime">{span(rd.uptime_s * 1000)}</Field>
            </dl>
          ) : (
            <p className="text-[13px] text-con-bad">{rd.error ?? "No response"}</p>
          )}
        </Card>

        <Card title="App">
          <dl className="divide-y divide-con-line">
            <Field label="Package">
              {app.name} {app.version}
            </Field>
            <Field label="Next.js">{app.next}</Field>
            <Field label="Node">{app.node}</Field>
            <Field label="Mode">{app.env}</Field>
            <Field label="Branch">{app.branch ?? "–"}</Field>
            <Field label="Commit" mono>
              {app.commit ?? "–"}
            </Field>
            <Field label="Process uptime">{span(app.uptime_s * 1000)}</Field>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Migrations"
          description={migrations.journal ? "drizzle/meta/_journal.json compared with drizzle.__drizzle_migrations." : "The migration journal was not found next to the app."}
          aside={pending ? <Pill tone="warn">{pending} not applied</Pill> : <Pill>Up to date</Pill>}
          flush
        >
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-con-line">
                <th className={tableHead}>Migration</th>
                <th className={tableHead}>State</th>
                <th className={tableHead}>Created</th>
              </tr>
            </thead>
            <tbody>
              {migrations.items.map((m) => (
                <tr key={m.tag} className="border-b border-con-line last:border-0">
                  <td className={cn(tableCell, "font-mono text-[12px]")}>{m.tag}</td>
                  <td className={tableCell}>
                    {m.state === "applied" ? (
                      <Pill>Applied</Pill>
                    ) : m.state === "changed" ? (
                      <Pill tone="warn" title="The SQL file changed after it was applied">
                        Applied, file changed
                      </Pill>
                    ) : (
                      <Pill tone="warn">Pending</Pill>
                    )}
                  </td>
                  <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{dateTime(new Date(m.when).toISOString())}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {migrations.applied_unknown > 0 && (
            <p className="border-t border-con-line px-5 py-3 text-[12px] text-con-warn">
              {migrations.applied_unknown} applied migration{migrations.applied_unknown === 1 ? " is" : "s are"} not in this checkout&apos;s journal.
            </p>
          )}
        </Card>

        <Card title="Configuration" description="Checks only; secret values are never shown." flush>
          <ul className="divide-y divide-con-line">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-3 px-5 py-2.5 text-[13px]">
                <span aria-hidden className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", c.ok ? "bg-con-fg3" : "bg-con-warn")} />
                <div className="min-w-0 flex-1">
                  <p className="text-con-fg">{c.label}</p>
                  {c.hint && <p className="text-[12px] text-con-fg3">{c.hint}</p>}
                </div>
                <span className={cn("max-w-[55%] break-words text-right", c.ok ? "text-con-fg2" : "text-con-warn")}>{c.value}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Tables" description={`${tables.length} tables, ${totalRows.toLocaleString("en-US")} rows in total (exact counts).`} flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead>
              <tr className="border-b border-con-line">
                <th className={tableHead}>Table</th>
                <th className={cn(tableHead, "text-right")}>Rows</th>
                <th className={cn(tableHead, "text-right")}>Size on disk</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.name} className="border-b border-con-line last:border-0">
                  <td className={cn(tableCell, "font-mono text-[12px]")}>{t.name}</td>
                  <td className={cn(tableCell, "text-right tabular-nums")}>{t.rows.toLocaleString("en-US")}</td>
                  <td className={cn(tableCell, "text-right tabular-nums text-con-fg2")}>{bytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
