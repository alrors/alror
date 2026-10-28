import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { ShellToaster } from "@/components/console/shell-toast";
import { LogoMark } from "@/components/navbar";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { stalledCount } from "@/lib/server/admin/overview";

export const metadata: Metadata = {
  title: { default: "Admin · Alror", template: "%s · Alror admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  // 404 for anyone who is not a platform admin (signed out included): the
  // route is not revealed. Pages, actions and handlers check again.
  const admin = await requirePlatformAdmin();
  const stalled = await stalledCount(admin);

  return (
    // Fixed viewport frame: the top bar and sidebar stay put, only <main> scrolls.
    // Height comes from h-dvh max-h-dvh alone (no flex-1 on the frame).
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-con-bg text-con-fg">
      <ShellToaster />
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-con-line bg-con-bg px-3 sm:px-4">
        <Link href="/admin" className="flex items-center gap-2 rounded-md px-1 text-[14px] font-semibold tracking-[-0.02em] text-con-fg">
          <LogoMark className="h-5 w-5" />
          <span className="hidden sm:inline">Alror</span>
        </Link>
        <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-con-line-hover px-2 text-[12px] font-medium text-con-fg">
          <ShieldCheck size={12} className="text-con-fg2" />
          Admin
        </span>
        <span className="hidden text-[12px] text-con-fg3 md:inline">Instance operator panel, all organizations</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden max-w-[220px] truncate text-[12px] text-con-fg2 sm:inline" title={admin.email}>
            {admin.email}
          </span>
          <Link
            href="/app"
            className="con-ease inline-flex h-7 items-center gap-1.5 rounded-md border border-con-line px-2.5 text-[12px] text-con-fg2 hover:border-con-line-hover hover:text-con-fg"
          >
            <ArrowLeft size={13} />
            Back to console
          </Link>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <AdminSidebar stalled={stalled} />
        <main data-scroller className="con-scroll min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-8 sm:py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
