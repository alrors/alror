import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/navbar";

/** Shared frame for the signed-out pages (/login, /signup, /invite). */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-1 flex-col bg-con-bg text-con-fg">
      <header className="flex h-14 items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.03em]">
          <LogoMark className="h-6 w-6" />
          alror
        </Link>
        <Link href="/" className="text-[13px] text-con-fg2 transition-colors duration-150 hover:text-con-fg">
          Back to site
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[380px]">
          <div className="rounded-lg border border-con-line bg-con-panel p-7">
            <LogoMark className="h-9 w-9" />
            <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
            <p className="mt-1 text-[14px] text-con-fg2">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-4 space-y-1 text-center text-[13px] text-con-fg3">{footer}</div>}
        </div>
      </div>
    </main>
  );
}

export const authLink = "text-con-fg2 underline-offset-4 transition-colors duration-150 hover:text-con-fg hover:underline";
