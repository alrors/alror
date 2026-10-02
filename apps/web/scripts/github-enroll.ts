/** Operator-only command. Never expose this capability as a public installation-ID callback. */
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/lib/server/db";
import { githubDeliveries, githubRepositories, orgs } from "../src/lib/server/db/schema";
import { systemActor } from "../src/lib/server/context";
import { writeAudit } from "../src/lib/server/data/audit";
import { installationClient, repoPath } from "../src/lib/server/github/client";
import { DEFAULT_POLICY } from "../src/lib/server/github/types";

async function main() {
  const { values } = parseArgs({ options: { org: { type: "string" }, installation: { type: "string" }, repository: { type: "string" }, operator: { type: "string" }, "verified-authority": { type: "boolean" } } });
  if (!values.org || !values.installation || !values.repository || !values.operator || !values["verified-authority"]) throw new Error("Usage: github-enroll.ts --org <Alror slug> --installation <id> --repository <owner/repo> --operator <operator identity> --verified-authority. Verify the requesting Alror admin's authority over this GitHub repository before enrolling.");
  const [org] = await db.select().from(orgs).where(eq(orgs.slug, values.org));
  if (!org) throw new Error("Alror organization not found.");
  const client = await installationClient(values.installation);
  const repo = await client.request<{ id: number; full_name: string }>(repoPath(values.repository));
  const scoped = await installationClient(values.installation, String(repo.id));
  await scoped.request(repoPath(repo.full_name));
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(githubRepositories).where(eq(githubRepositories.id, String(repo.id)));
    if (existing && existing.orgId !== org.id) throw new Error("Repository already belongs to another Alror workspace; operator reassignment is not supported.");
    if (existing) await tx.update(githubRepositories).set({ enabled: true, installationId: values.installation!, fullName: repo.full_name, updatedAt: new Date() }).where(eq(githubRepositories.id, existing.id));
    else await tx.insert(githubRepositories).values({ id: String(repo.id), orgId: org.id, installationId: values.installation!, fullName: repo.full_name, policy: DEFAULT_POLICY, enrolledBy: values.operator! });
    await writeAudit({ orgId: org.id, actor: { ...systemActor(), label: values.operator! } }, "github.repository_enrolled", repo.full_name, { installation_id: values.installation, repository_id: String(repo.id) }, tx);
    await tx.insert(githubDeliveries).values({ id: `enroll:${randomUUID()}`, event: "reconcile", installationId: values.installation!, repositoryId: String(repo.id), payload: { reason: "operator_enrolled" } });
  });
  console.log(`Enrolled ${repo.full_name} in workspace ${org.slug}. New repositories start in observe mode.`);
}
main().catch((e: Error) => { console.error(e.message); process.exitCode = 1; }).finally(closeDb);
