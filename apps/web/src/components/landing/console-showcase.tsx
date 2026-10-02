"use client";

import { useId, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/site";

const VIEWS = [
  {
    id: "deployments",
    label: "Deployments",
    src: "/generated/console-deployments.webp",
    w: 1440,
    h: 1100,
    alt: "Alror console, Deployments: every release with its status, risk score, stages, traffic and duration",
    caption: "Every release across your services: risk, rollout progress and verdicts.",
  },
  {
    id: "release",
    label: "Release detail",
    src: "/generated/console-deployment.webp",
    w: 1440,
    h: 1400,
    alt: "Alror console, a rolled-back release: the rollout tree, the failed verdict and canary versus baseline charts",
    caption: "The rollout tree for one release, with the verdict and charts behind every decision.",
  },
  {
    id: "services",
    label: "Services",
    src: "/generated/console-services.webp",
    w: 1440,
    h: 1250,
    alt: "Alror console, Services: live rollouts with stage progress and latency, and a health card per service",
    caption: "Live rollouts and the health of every service, with usage against your plan.",
  },
  {
    id: "insights",
    label: "Insights",
    src: "/generated/console-insights.webp",
    w: 1440,
    h: 1300,
    alt: "Alror console, Insights: deploys per day, change failure rate, time to restore, average risk and AI-assisted share",
    caption: "Delivery metrics, risk distribution and the AI-assisted share of your changes.",
  },
];

export function ConsoleShowcase() {
  const [active, setActive] = useState(0);
  const base = useId();
  const v = VIEWS[active];

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length;
    setActive(next);
    document.getElementById(`${base}-v${next}`)?.focus();
  };

  return (
    <div className="mt-14" data-reveal>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" aria-label="Console views" className="lp-scroll flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[#1d1d22] bg-[#0b0b0d] p-1">
          {VIEWS.map((x, i) => (
            <button
              key={x.id}
              id={`${base}-v${i}`}
              role="tab"
              type="button"
              aria-selected={i === active}
              aria-controls={`${base}-panel`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-white/60",
                i === active ? "bg-[#1c1c21] text-fg" : "text-[#6e6e78] hover:text-[#a3a3ad]",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-[#6e6e78]">{v.caption}</p>
      </div>

      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-v${active}`}
        className="lp-panel mt-4 overflow-hidden rounded-2xl p-1.5"
      >
        <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-[#121212]">
          {VIEWS.map((x, i) => (
            <Image
              key={x.id}
              src={x.src}
              alt={i === active ? x.alt : ""}
              aria-hidden={i !== active}
              width={x.w}
              height={x.h}
              sizes="(min-width: 1200px) 1130px, 100vw"
              className={cn(
                "absolute inset-x-0 top-0 h-auto w-full transition-opacity duration-500",
                i === active ? "opacity-100" : "opacity-0",
              )}
            />
          ))}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0e0e11] to-transparent" aria-hidden />
        </div>
      </div>
    </div>
  );
}
