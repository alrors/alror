import type { Metadata } from "next";
import { SettingsNav } from "@/components/console/settings/settings-nav";
import { requireSession } from "@/lib/console/auth";
import { isAdminRole } from "@/lib/server/context";

export const metadata: Metadata = { title: { default: "Settings", template: "%s · Settings · Alror console" } };

export default async function SettingsLayout({ children }: LayoutProps<"/app/settings">) {
  const session = await requireSession();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Settings</h1>
        <p className="mt-1 text-[14px] text-con-fg2">
          Organization {session.org.name} · you are {session.role === "admin" ? "an admin" : `${session.role === "owner" ? "an owner" : "a member"}`}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <SettingsNav isAdmin={isAdminRole(session.role)} />
          {!isAdminRole(session.role) && (
            <p className="mt-3 hidden px-2.5 text-[12px] leading-snug text-con-fg3 lg:block">
              Pages marked Admins need the owner or admin role. Ask an owner of {session.org.name} if you need access.
            </p>
          )}
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
