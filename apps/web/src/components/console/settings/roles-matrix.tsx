import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/site";

type Role = "owner" | "admin" | "member";

/** What each role can do. Mirrors the server checks (requireAdmin, scopes per role). */
export const PERMISSIONS: { label: string; detail: string; roles: Role[] }[] = [
  { label: "View services, releases, jobs and insights", detail: "Everything on the console's main pages.", roles: ["owner", "admin", "member"] },
  { label: "Deploy, roll back and cancel jobs", detail: "Queues jobs for alror runner (deploy:write).", roles: ["owner", "admin", "member"] },
  { label: "Create and edit services", detail: "Add, archive and change service paths.", roles: ["owner", "admin"] },
  { label: "Change policies and environments", detail: "Thresholds, rollout plans, protected environments.", roles: ["owner", "admin"] },
  { label: "Create and revoke API keys", detail: "Keys for the CLI, CI and runners.", roles: ["owner", "admin"] },
  { label: "Invite and manage members", detail: "Admins cannot change or remove owners.", roles: ["owner", "admin"] },
  { label: "Read the audit log and feedback", detail: "Every change, by people, keys and the system.", roles: ["owner", "admin"] },
  { label: "Rename the organization", detail: "Name and slug.", roles: ["owner", "admin"] },
  { label: "Grant the owner role", detail: "The last owner can never be removed.", roles: ["owner"] },
];

const ROLES: { role: Role; label: string; blurb: string }[] = [
  { role: "owner", label: "Owner", blurb: "Full control, including other owners." },
  { role: "admin", label: "Admin", blurb: "Manages people, keys and config." },
  { role: "member", label: "Member", blurb: "Ships releases, reads everything." },
];

/** Roles and permissions table. `highlight` marks the viewer's own role column. */
export function RolesMatrix({ highlight, compact }: { highlight?: string; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="border-b border-con-line">
            <th className="h-10 pl-5 pr-4 text-left text-[12px] font-medium uppercase text-con-fg3">Permission</th>
            {ROLES.map((r) => (
              <th key={r.role} className={cn("h-10 w-28 px-3 text-center text-[12px] font-medium text-con-fg2", r.role === highlight && "bg-con-row/60 text-con-fg")}>
                {r.label}
                {r.role === highlight && <span className="block text-[10px] font-normal uppercase tracking-[0.06em] text-con-fg3">You</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSIONS.map((p) => (
            <tr key={p.label} className="border-b border-con-row last:border-0">
              <td className="py-2.5 pl-5 pr-4">
                <div className="text-con-fg">{p.label}</div>
                {!compact && <div className="text-[12px] text-con-fg3">{p.detail}</div>}
              </td>
              {ROLES.map((r) => {
                const yes = p.roles.includes(r.role);
                return (
                  <td key={r.role} className={cn("px-3 text-center", r.role === highlight && "bg-con-row/60")}>
                    {yes ? (
                      <Check size={15} className="mx-auto text-con-fg" aria-label="Allowed" />
                    ) : (
                      <Minus size={15} className="mx-auto text-con-fg3/60" aria-label="Not allowed" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {!compact && (
          <tfoot>
            <tr className="border-t border-con-line">
              <td className="py-2.5 pl-5 pr-4 text-[12px] text-con-fg3">In short</td>
              {ROLES.map((r) => (
                <td key={r.role} className={cn("px-3 py-2.5 text-center text-[12px] leading-snug text-con-fg3", r.role === highlight && "bg-con-row/60")}>
                  {r.blurb}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** The permissions the given role has, as a plain list (for "what can I do"). */
export function permissionsFor(role: string) {
  return PERMISSIONS.map((p) => ({ ...p, allowed: p.roles.includes(role as Role) }));
}
