"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { deploy, type DeployState } from "@/app/app/actions";
import { rolloutPlans } from "@/app/app/deployments/actions";
import { Dialog } from "@/components/console/dialog";
import { Spinner } from "@/components/console/loader";
import { FormField, FormStatus, buttonClass, inputClass } from "@/components/console/primitives";
import { Selector, type SelectorOption } from "@/components/console/selector";
import { LEVEL_BANDS, levelFor, minutesLabel, planBakeMinutes, planFor } from "@/components/console/release-story";
import { DEFAULT_PLANS, LEVELS, type Plans } from "@/lib/console/policy-rules";
import type { Level } from "@/lib/console/types";
import { cn } from "@/lib/site";

export type DeployDefaults = {
  services: string[];
  environments: { name: string; protected: boolean }[];
  service?: string;
  /** image repository without a tag, used to prefill the image field */
  imageRepo?: string;
  environment?: string;
  /** The org's rollout plans; fetched when the dialog opens if not given. */
  plans?: Plans;
  bakeScale?: number;
};

const CLOSE_MS = 140;

const RISK_OPTIONS: SelectorOption[] = [
  { value: "", label: "Scored by the runner", description: "The runner scores the change and picks the plan." },
  { value: "low", label: "Override: low", description: "Fastest plan, fewest stages.", group: "Override" },
  { value: "medium", label: "Override: medium", description: "The middle plan.", group: "Override" },
  { value: "high", label: "Override: high", description: "Slowest plan, longest bakes.", group: "Override" },
  { value: "score", label: "Override: score", description: "Enter a 0 to 100 score; the plan follows its band.", group: "Override" },
];

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/** "Deploy" button that opens the deploy dialog. The dialog queues a deploy job for alror runner. */
export function DeployButton({ defaults, variant = "primary", label = "Deploy", className }: { defaults: DeployDefaults; variant?: "primary" | "topbar"; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [round, setRound] = useState(0);
  const closingRef = useRef(false);
  // Stable identity, so the dialog's focus effect does not re-run while it fades out.
  const close = useCallback(() => {
    if (closingRef.current) return;
    const finish = () => {
      closingRef.current = false;
      setOpen(false);
      setClosing(false);
      setRound((r) => r + 1);
    };
    if (reducedMotion()) return finish();
    closingRef.current = true;
    setClosing(true);
    setTimeout(finish, CLOSE_MS);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(buttonClass.primary, variant === "topbar" && "ml-2 hidden sm:inline-flex", className)}
      >
        <Plus size={15} strokeWidth={2.25} />
        {label}
      </button>
      {open && (
        <DeployDialog
          key={round}
          defaults={defaults}
          closing={closing}
          onClose={close}
        />
      )}
    </>
  );
}

/** A tag (repo:tag) or a digest (repo@sha256:...) is required; the registry host may carry a port. */
function imageError(image: string): string | undefined {
  const v = image.trim();
  if (!v) return "Enter an image.";
  if (/\s/.test(v)) return "Image names cannot contain spaces.";
  if (v.includes("@")) return /@sha256:[0-9a-f]{64}$/.test(v) ? undefined : "A digest looks like repo@sha256: followed by 64 hex characters.";
  const last = v.split("/").pop() ?? "";
  const i = last.lastIndexOf(":");
  if (i < 0 || i === last.length - 1) return "Add a tag after the colon, for example :v3.19.0 or a commit SHA.";
  if (i === 0) return "Add the repository name before the tag.";
  return undefined;
}

function scoreError(score: string): string | undefined {
  if (score === "") return "Enter a score from 0 to 100.";
  if (!/^\d{1,3}$/.test(score) || Number(score) > 100) return "The score must be a whole number from 0 to 100.";
  return undefined;
}

/** Live preview of the rollout plan the chosen risk leads to. */
function PlanPreview({ risk, score, plans, bakeScale }: { risk: string; score: string; plans: Plans; bakeScale: number }) {
  const level: Level | null = LEVELS.includes(risk as Level) ? (risk as Level) : risk === "score" && !scoreError(score) ? levelFor(Number(score)) : null;

  if (!level) {
    return (
      <div className="space-y-2">
        <p className="text-[12px] text-con-fg3">
          {risk === "score" ? "Enter a valid score to see its plan." : "The runner scores the change, then uses one of these plans:"}
        </p>
        {risk !== "score" && (
          <ul className="space-y-1.5">
            {LEVEL_BANDS.map((b) => {
              const steps = planFor(b.level, plans);
              return (
                <li key={b.level} className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="capitalize text-con-fg2">
                    {b.level} <span className="text-con-fg3">({b.from} to {b.to})</span>
                  </span>
                  <span className="font-mono tabular-nums text-con-fg3">
                    {steps.map((s) => s.weight).join(" → ")} · {minutesLabel(planBakeMinutes(steps, bakeScale))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  const steps = planFor(level, plans);
  const band = LEVEL_BANDS.find((b) => b.level === level)!;
  const total = planBakeMinutes(steps, bakeScale);
  return (
    <div key={`${level}`} className="con-fade space-y-2.5">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-con-fg">
          <span className="capitalize">{level}</span> risk plan · {steps.length} stages
        </span>
        <span className="font-mono tabular-nums text-con-fg3">total bake {minutesLabel(total)}</span>
      </div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="grid grid-cols-[52px_minmax(0,1fr)_64px] items-center gap-2 text-[12px]">
            <span className="font-mono tabular-nums text-con-fg2">{s.weight}%</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-con-row">
              <span className={cn("con-grow-x block h-full rounded-full", s.weight >= 100 ? "bg-con-fg2" : "bg-con-fg3")} style={{ width: `${s.weight}%`, animationDelay: `${i * 50}ms` }} />
            </span>
            <span className="text-right font-mono tabular-nums text-con-fg3">{s.weight >= 100 ? "promote" : minutesLabel(s.bakeMin * bakeScale)}</span>
          </li>
        ))}
      </ol>
      <p className="text-[12px] leading-relaxed text-con-fg3">{band.meaning}</p>
    </div>
  );
}

function DeployDialog({ defaults, onClose, closing }: { defaults: DeployDefaults; onClose: () => void; closing: boolean }) {
  const [state, action, pending] = useActionState<DeployState, FormData>(deploy, undefined);
  const fixed = Boolean(defaults.service);
  const [service, setService] = useState(defaults.service ?? defaults.services[0] ?? "");
  const envs = defaults.environments;
  const [environment, setEnvironment] = useState(
    defaults.environment && envs.some((e) => e.name === defaults.environment) ? defaults.environment : (envs.find((e) => e.name === "production") ?? envs[0])?.name ?? "production",
  );
  const [risk, setRisk] = useState("");
  const [score, setScore] = useState("");
  const repo = fixed ? (defaults.imageRepo ?? `registry/${service}`) : `registry/${service}`;
  const [image, setImage] = useState(`${repo}:`);
  const [touched, setTouched] = useState(false);
  const [policy, setPolicy] = useState<{ plans: Plans; bakeScale: number } | null>(defaults.plans ? { plans: defaults.plans, bakeScale: defaults.bakeScale ?? 1 } : null);
  const isProtected = envs.find((e) => e.name === environment)?.protected;
  const panelClass = closing ? "animate-[con-fade_140ms_ease-in_reverse_both] motion-reduce:animate-none" : "con-scale-in";

  useEffect(() => {
    if (defaults.plans) return;
    let live = true;
    rolloutPlans().then(
      (p) => live && setPolicy(p),
      () => live && setPolicy({ plans: DEFAULT_PLANS, bakeScale: 1 }),
    );
    return () => {
      live = false;
    };
  }, [defaults.plans]);

  const imgErr = imageError(image);
  const scoreErr = risk === "score" ? scoreError(score) : undefined;

  if (state?.ok) {
    return (
      <Dialog open onClose={onClose} className={panelClass} title="Deploy queued" description="An alror runner claims the job, runs the rollout and records it as a deployment.">
        <div className="con-fade space-y-4 text-[13px] text-con-fg2">
          <p>
            Job <span className="font-mono text-con-fg">{state.jobId}</span> is queued for <span className="text-con-fg">{service}</span> in{" "}
            <span className="text-con-fg">{environment}</span>. Its status updates live on the service page and in Jobs.
          </p>
          <p>
            No runner yet? Start one with <code className="rounded bg-con-row px-1 font-mono text-con-fg">alror runner</code> using a key with the jobs:run scope.
          </p>
          <div className="flex justify-end gap-2">
            <Link href="/app/jobs" onClick={onClose} className={buttonClass.secondary}>
              View jobs
            </Link>
            <button type="button" onClick={onClose} className={buttonClass.primary}>
              Done
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      className={cn(panelClass, "max-w-[520px]")}
      title={fixed ? `Deploy ${service}` : "Deploy a service"}
      description="Queues a deploy job. Alror scores the change, picks a rollout plan and verifies every stage."
    >
      <form
        action={action}
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          setTouched(true);
          if (imgErr || scoreErr || !service) e.preventDefault();
        }}
      >
        {fixed ? (
          <input type="hidden" name="service" value={service} />
        ) : (
          <FormField label="Service" htmlFor="deploy-service">
            <Selector
              id="deploy-service"
              name="service"
              aria-label="Service"
              value={service}
              onValueChange={(v) => {
                setService(v);
                setImage(`registry/${v}:`);
              }}
              required
              searchPlaceholder="Find a service…"
              options={defaults.services.map((s) => ({ value: s, label: s }))}
            />
          </FormField>
        )}
        <FormField label="Image" htmlFor="deploy-image" hint="The image and tag to roll out (the version)." error={touched ? imgErr : undefined}>
          <input
            id="deploy-image"
            name="image"
            required
            maxLength={512}
            value={image}
            onChange={(e) => setImage(e.target.value)}
            onBlur={() => image !== `${repo}:` && setTouched(true)}
            aria-invalid={touched && Boolean(imgErr)}
            spellCheck={false}
            autoComplete="off"
            className={`${inputClass} font-mono`}
            data-autofocus
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Ref" htmlFor="deploy-ref" hint="Optional: commit, tag or PR.">
            <input id="deploy-ref" name="ref" maxLength={256} placeholder="#4821 or v3.19.0" spellCheck={false} autoComplete="off" className={`${inputClass} font-mono`} />
          </FormField>
          <FormField label="Environment" htmlFor="deploy-env" hint={isProtected ? "Protected environment." : undefined}>
            <Selector
              id="deploy-env"
              name="environment"
              aria-label="Environment"
              value={environment}
              onValueChange={setEnvironment}
              options={envs.map((e) => ({ value: e.name, label: e.name, meta: e.protected ? "protected" : undefined }))}
            />
          </FormField>
        </div>
        <FormField
          label="Risk"
          htmlFor="deploy-risk"
          hint="Leave it to the runner, or override the level or score the rollout plan is chosen from."
          error={touched || score !== "" ? scoreErr : undefined}
        >
          <div className="flex gap-2">
            <Selector
              id="deploy-risk"
              aria-label="Risk"
              className="flex-1"
              value={risk}
              onValueChange={setRisk}
              minWidth={280}
              options={RISK_OPTIONS}
            />
            {risk === "score" && (
              <input
                aria-label="Risk score"
                type="number"
                min={0}
                max={100}
                step={1}
                required
                value={score}
                onChange={(e) => setScore(e.target.value)}
                aria-invalid={Boolean(scoreErr) && (touched || score !== "")}
                placeholder="0 to 100"
                className={cn(inputClass, "con-scale-in w-28 font-mono")}
              />
            )}
          </div>
          <input type="hidden" name="risk_override" value={risk === "score" ? score : risk} />
        </FormField>

        <div className="rounded-md border border-con-line bg-con-bg px-3.5 py-3" aria-live="polite">
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.04em] text-con-fg3">Rollout plan preview</div>
          {policy ? (
            <PlanPreview risk={risk} score={score} plans={policy.plans} bakeScale={policy.bakeScale} />
          ) : (
            <div className="space-y-1.5" aria-hidden>
              <div className="con-skeleton h-3 w-2/3" />
              <div className="con-skeleton h-3 w-1/2" />
              <div className="con-skeleton h-3 w-3/4" />
            </div>
          )}
        </div>

        <label className="flex items-start gap-2.5 text-[13px] text-con-fg2">
          <input type="checkbox" name="shadow" className="mt-0.5 h-3.5 w-3.5 accent-[#ededed]" />
          <span>
            Shadow run
            <span className="block text-[12px] text-con-fg3">Verdicts are recorded but never trigger a rollback.</span>
          </span>
        </label>
        <div className="flex items-center justify-between gap-3 border-t border-con-line pt-4">
          <FormStatus error={state?.error} />
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" disabled={pending || !service} className={buttonClass.primary}>
              {pending && <Spinner />}
              Queue deploy
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
