"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ClipboardList,
  Cpu,
  LayoutDashboard,
  MessageSquareText,
  Puzzle,
  ScrollText,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/site";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };

export const ADMIN_NAV: Item[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/orgs", label: "Organizations", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/jobs", label: "Jobs & runners", icon: ClipboardList },
  { href: "/admin/plugins", label: "Plugins", icon: Puzzle },
  { href: "/admin/feedback", label: "Feedback", icon: MessageSquareText },
  { href: "/admin/audit", label: "Audit", icon: ScrollText },
  { href: "/admin/system", label: "System", icon: Cpu },
];

const isActive = (it: Item, p: string) => (it.exact ? p === it.href : p === it.href || p.startsWith(`${it.href}/`));

/** Compact admin navigation: icons and labels from md up, icons only below. */
export function AdminSidebar({ stalled }: { stalled: number }) {
  const pathname = usePathname() ?? "/admin";
  return (
    <nav aria-label="Admin" className="flex w-14 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-con-line bg-con-bg px-2 py-3 lg:w-52">
      <p className="mb-1 hidden px-2 text-[11px] font-medium uppercase tracking-wide text-con-fg3 lg:block">Instance</p>
      {ADMIN_NAV.map((it) => {
        const active = isActive(it, pathname);
        const Icon = it.icon;
        const badge = it.href === "/admin/jobs" && stalled > 0 ? stalled : 0;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            title={it.label}
            className={cn(
              "con-ease group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]",
              active ? "bg-con-row text-con-fg" : "text-con-fg3 hover:bg-con-hover hover:text-con-fg",
            )}
          >
            <Icon size={16} strokeWidth={1.7} className="shrink-0" />
            <span className="hidden min-w-0 flex-1 truncate lg:inline">{it.label}</span>
            {badge > 0 && (
              <span
                title={`${badge} stalled`}
                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-con-warn lg:static lg:inline-flex lg:h-5 lg:w-auto lg:items-center lg:rounded-full lg:bg-con-row lg:px-1.5 lg:text-[11px] lg:tabular-nums lg:text-con-warn"
              >
                <span className="hidden lg:inline">{badge}</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
