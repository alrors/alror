/* eslint-disable @next/next/no-img-element -- small local SVG logos, no optimisation needed */
import { siArgo } from "simple-icons";
import { Container } from "../ui";
import { SimpleLogo } from "./brand-logos";

type Item = { name: string; src?: string; wide?: boolean; note?: string };

const items: Item[] = [
  { name: "Kubernetes", src: "/integrations/kubernetes.svg" },
  { name: "Argo Rollouts" },
  { name: "Amazon ECS", src: "/integrations/ecs.svg", note: "beta" },
  { name: "Prometheus", src: "/integrations/prometheus.svg" },
  { name: "Datadog", src: "/integrations/datadog.svg" },
  { name: "GitHub Actions", src: "/integrations/github-actions.svg" },
  { name: "Slack", src: "/integrations/slack.svg" },
  { name: "Go + TS SDKs", src: "/integrations/go-sdk.svg", wide: true },
];

export function Integrations() {
  return (
    <section aria-labelledby="integrations-title" className="lp-integrations lp-rule py-10 sm:py-12">
      <Container>
        <h2 id="integrations-title" className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#6e6e78]">
          Works with the stack you already run
        </h2>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 xl:flex-nowrap xl:justify-between xl:gap-x-4">
          {items.map((it) => (
            <li key={it.name} className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#24242a] bg-[#16161a]">
                {it.src ? (
                  <img src={it.src} alt="" className={it.wide ? "h-3 w-6 object-contain" : "h-4 w-4 object-contain"} />
                ) : (
                  <SimpleLogo icon={siArgo} className="h-4 w-4" />
                )}
              </span>
              <span className="whitespace-nowrap text-[13.5px] font-medium text-[#d4d4d8]">
                {it.name}
                {it.note && <span className="ml-1.5 font-mono text-[10px] font-normal text-[#6e6e78]">{it.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
