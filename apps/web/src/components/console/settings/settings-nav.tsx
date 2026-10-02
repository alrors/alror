"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, KeyRound, Mail, MessageSquare, ScrollText, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/site";

const ITEMS: { href: string; label: string; icon: LucideIcon; exact?: boolean; admin?: boolean }[] = [
  { href: "/app/settings", label: "General", icon: Building2, exact: true },
  { href: "/app/settings/members", label: "Members", icon: Users, admin: true },
  { href: "/app/settings/invites", label: "Invites", icon: Mail, admin: true },
  { href: "/app/settings/api-keys", label: "API keys", icon: KeyRound, admin: true },
  { href: "/app/settings/audit", label: "Audit log", icon: ScrollText, admin: true },
  { href: "/app/settings/feedback", label: "Feedback", icon: MessageSquare, admin: true },
];

/** Settings sub-navigation: a vertical list on wide screens, horizontal tabs on small ones. */
export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="-mx-1 flex gap-1 overflow-x-auto border-b border-con-line pb-px lg:mx-0 lg:flex-col lg:gap-0.5 lg:border-0 lg:pb-0">
      {ITEMS.map((it) => {
        const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
        const locked = it.admin && !isAdmin;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 text-[14px] transition-colors duration-150",
              active ? "bg-con-row text-con-fg" : "text-con-fg2 hover:bg-con-hover hover:text-con-fg",
              locked && !active && "text-con-fg3",
            )}
          >
            <it.icon size={15} strokeWidth={1.7} className={cn("shrink-0", active ? "text-con-fg" : "text-con-fg3")} />
            <span className="flex-1">{it.label}</span>
            {locked && <span className="hidden text-[11px] text-con-fg3 lg:inline">Admins</span>}
          </Link>
        );
      })}
    </nav>
  );
}
