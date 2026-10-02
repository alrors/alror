import Image from "next/image";
import { Activity, Box, Container, Flag, MessageSquare, SquareTerminal, Zap, type LucideIcon } from "lucide-react";
import { pluginLogoUrl } from "@/lib/marketplace-logos";
import type { PluginLogo } from "@/lib/server/marketplace/catalog";
import { cn } from "@/lib/site";

const ICONS: Record<Extract<PluginLogo, { type: "icon" }>["icon"], LucideIcon> = {
  activity: Activity,
  box: Box,
  container: Container,
  message: MessageSquare,
  zap: Zap,
  flag: Flag,
  terminal: SquareTerminal,
};

const SIZES = {
  sm: { box: "h-8 w-8 rounded-md", px: 32 },
  md: { box: "h-10 w-10 rounded-lg", px: 40 },
  lg: { box: "h-12 w-12 rounded-xl", px: 48 },
} as const;

/** Logos that already carry their own tile and render edge to edge. */
const FULL_BLEED = new Set(["alror-cli"]);

/**
 * Plugin logo tile. Brand logos (public/integrations, original colours) sit on a
 * light tile so dark marks stay readable; plugins without one (synthetic,
 * simulated, feature flags) keep a lucide icon on the dark tile.
 */
export function MarketplaceLogo({ id, name, logo, size = "md", className }: { id: string; name: string; logo: PluginLogo; size?: "sm" | "md" | "lg"; className?: string }) {
  const s = SIZES[size];
  const url = pluginLogoUrl(id);
  if (url && FULL_BLEED.has(id)) {
    return <Image src={url} alt={`${name} logo`} width={s.px} height={s.px} unoptimized className={cn("shrink-0 object-contain", s.box, className)} />;
  }
  if (url) {
    const inner = Math.round(s.px * 0.6);
    return (
      <span className={cn("grid shrink-0 place-items-center border border-black/10 bg-[#f4f4f5]", s.box, className)}>
        <Image src={url} alt={`${name} logo`} width={inner} height={inner} unoptimized className="object-contain" style={{ width: inner, height: inner }} />
      </span>
    );
  }
  const Icon = logo.type === "icon" ? ICONS[logo.icon] : Box;
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center border border-con-line bg-con-bg text-con-fg", s.box, className)}>
      <Icon size={Math.round(s.px * 0.5)} strokeWidth={1.6} />
    </span>
  );
}
