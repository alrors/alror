import { ArrowUpRight } from "lucide-react";
import { Eyebrow } from "../ui";
import { InstallCommand, REPO_URL } from "./install";

const facts = [
  { k: "License", v: "Apache-2.0" },
  { k: "Release", v: "v0.1.0" },
  { k: "SDKs", v: "Go · TypeScript" },
  { k: "Exit codes", v: "2 rolled back · 3 gate" },
];

export function CliFacts() {
  return (
    <div className="min-w-0" data-reveal>
      <Eyebrow>04 · Open source</Eyebrow>
      <h2 className="mt-4 text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] text-balance text-fg sm:text-[44px]">
        The engine is a CLI.<span className="block text-[#6e6e78]">Run it wherever you deploy.</span>
      </h2>
      <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-[#a3a3ad]">
        Risk scoring, rollouts, verification and rollback all run inside one Go binary, usually as a single CI step. The
        output is built for humans, and the exit codes are built for CI.
      </p>

      <InstallCommand className="mt-8" />

      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#1d1d22] bg-[#1d1d22]">
        {facts.map((f) => (
          <div key={f.k} className="bg-[#0b0b0d] px-4 py-3.5">
            <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6e6e78]">{f.k}</dt>
            <dd className="mt-1 text-[14px] text-fg">{f.v}</dd>
          </div>
        ))}
      </dl>

      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex items-center gap-1.5 text-[14px] text-[#d4d4d8] underline decoration-[#3a3a42] underline-offset-4 transition-colors hover:text-fg hover:decoration-[#a3a3ad]"
      >
        github.com/alrors/alror
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </a>
    </div>
  );
}
