import { cn } from "@/lib/site";

/** Up to two initials from a name or an email ("Ada Lovelace" -> AL, "sam.lee@x" -> SL). */
export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") && !nameOrEmail.includes(" ") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const out = parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return out.toUpperCase();
}

/** Stable, muted tint per person so avatars are easy to tell apart without being loud. */
function tint(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 14% 24%)`;
}

export function MemberAvatar({ name, email, size = 28, className }: { name?: string | null; email: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-medium text-con-fg ring-1 ring-con-line", className)}
      style={{ width: size, height: size, background: tint(email), fontSize: Math.round(size * 0.4) }}
    >
      {initials(name || email)}
    </span>
  );
}
