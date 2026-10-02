import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/navbar";
import { PREVIEWS } from "@/lib/dev-previews";

export const metadata: Metadata = { title: "Error screens · Alror (development)", robots: { index: false } };

// Development only: every error and failure screen, rendered on demand with
// realistic data, without breaking Postgres, Redis or the network.
export default function ErrorPreviews() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="min-h-dvh flex-1 bg-con-bg text-con-fg">
      <div className="mx-auto w-full max-w-[880px] px-4 py-10 sm:px-8 sm:py-14">
        <div className="flex items-center gap-3">
          <LogoMark className="h-8 w-8" />
          <span className="rounded-full border border-con-line px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.06em] text-con-fg3">Development</span>
        </div>
        <h1 className="mt-6 text-[28px] font-semibold tracking-[-0.025em]">Error and failure screens</h1>
        <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-con-fg2">
          Each link renders the real screen. Outage previews use a simulated health check and never recover on their own; console previews need a signed-in session.
          This page is a 404 in production.
        </p>
        <div className="mt-10 space-y-10">
          {PREVIEWS.map((g) => (
            <section key={g.group}>
              <h2 className="text-[12px] font-medium uppercase tracking-[0.04em] text-con-fg3">{g.group}</h2>
              <ul className="mt-3 divide-y divide-con-line overflow-hidden rounded-lg border border-con-line bg-con-panel">
                {g.items.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} className="group flex items-center gap-4 px-4 py-3.5 transition-colors duration-150 hover:bg-con-hover sm:px-5">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-medium text-con-fg">{p.title}</span>
                          <span className="rounded border border-con-line px-1.5 text-[11px] text-con-fg3">{p.where}</span>
                        </span>
                        <span className="mt-0.5 block text-[13px] text-con-fg2">{p.detail}</span>
                        <span className="mt-1 block truncate font-mono text-[12px] text-con-fg3">{p.href}</span>
                      </span>
                      <ArrowRight size={14} className="shrink-0 text-con-fg3 transition-transform duration-150 group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
