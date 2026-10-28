"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { createService, editService, type ServiceResult } from "@/app/app/services/actions";
import { Dialog } from "@/components/console/dialog";
import { Spinner } from "@/components/console/loader";
import { FormField, FormStatus, buttonClass, inputClass } from "@/components/console/primitives";
import { Selector, type SelectorOption } from "@/components/console/selector";
import { cn } from "@/lib/site";

export type ServiceValues = {
  name: string;
  target: string;
  paths: string[];
  cluster?: string;
  namespace?: string;
  critical: boolean;
};

const EMPTY: ServiceValues = { name: "", target: "simulated", paths: [], cluster: "", namespace: "", critical: false };

/** A deploy target the org enabled in the marketplace (simulated is always there). */
export type TargetOption = { target: string; name: string; beta: boolean; defaults: { cluster?: string; namespace?: string } };

const SIMULATED_ONLY: TargetOption[] = [{ target: "simulated", name: "Simulated", beta: false, defaults: {} }];

/** "New service" button + dialog (owners and admins). Navigates to the new service on success. */
export function NewServiceButton({ className, targets = SIMULATED_ONLY }: { className?: string; targets?: TargetOption[] }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonClass.primary, className)}>
        <Plus size={14} strokeWidth={2.25} />
        New service
      </button>
      {open && (
        <ServiceDialog
          key={round}
          mode="create"
          initial={EMPTY}
          targets={targets}
          onClose={() => {
            setOpen(false);
            setRound((r) => r + 1);
          }}
        />
      )}
    </>
  );
}

/** "Edit" button + dialog for an existing service (owners and admins). */
export function EditServiceButton({ initial, targets = SIMULATED_ONLY }: { initial: ServiceValues; targets?: TargetOption[] }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass.secondary}>
        <Pencil size={13} />
        Edit
      </button>
      {open && (
        <ServiceDialog
          key={round}
          mode="edit"
          initial={initial}
          targets={targets}
          onClose={() => {
            setOpen(false);
            setRound((r) => r + 1);
          }}
        />
      )}
    </>
  );
}

function ServiceDialog({ mode, initial, targets, onClose }: { mode: "create" | "edit"; initial: ServiceValues; targets: TargetOption[]; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ServiceResult, FormData>(async (prev, fd) => {
    const r = await (mode === "create" ? createService : editService)(prev, fd);
    if (r?.ok) {
      onClose();
      if (mode === "create" && r.name) router.push(`/app/services/${encodeURIComponent(r.name)}`);
    }
    return r;
  }, undefined);
  const [target, setTarget] = useState(initial.target === "unknown" ? "simulated" : initial.target);
  const keep = initial.target !== "unknown" && !targets.some((t) => t.target === initial.target) ? initial.target : null;
  const targetOptions: SelectorOption[] = [
    ...targets.map((t) => ({ value: t.target, label: t.target, description: t.target === "simulated" ? "Built in, no infrastructure" : t.name, meta: t.beta ? "beta" : undefined })),
    ...(keep ? [{ value: keep, label: keep, description: "Current target, not enabled in the marketplace" }] : []),
  ];
  const defaults = targets.find((t) => t.target === target)?.defaults ?? {};
  // Keep the service's own cluster and namespace for its own target; otherwise prefill the target's defaults.
  const own = target === initial.target;
  const clusterDefault = own ? (initial.cluster ?? "") : (defaults.cluster ?? "");
  const nsDefault = own ? (initial.namespace ?? "") : (defaults.namespace ?? "");

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === "create" ? "New service" : `Edit ${initial.name}`}
      description={mode === "create" ? "Services are what Alror deploys. The CLI maps changed paths to services when it scores risk." : "Changes apply to the next deploy and to alror config pull."}
    >
      <form action={action} className="space-y-4">
        {mode === "create" ? (
          <FormField label="Name" htmlFor="svc-name" hint="Letters, digits, dots, dashes and underscores.">
            <input
              id="svc-name"
              name="name"
              required
              maxLength={63}
              pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
              placeholder="checkout-api"
              spellCheck={false}
              autoComplete="off"
              className={`${inputClass} font-mono`}
            />
          </FormField>
        ) : (
          <input type="hidden" name="name" value={initial.name} />
        )}
        <FormField label="Paths" htmlFor="svc-paths" hint="One per line or comma separated. Paths are prefixes, not globs: services/checkout/ matches every file under that folder. A change touching any of them counts as touching this service.">
          <textarea
            id="svc-paths"
            name="paths"
            rows={3}
            defaultValue={initial.paths.join("\n")}
            spellCheck={false}
            className={`${inputClass} h-auto py-2 font-mono leading-relaxed`}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Target" htmlFor="svc-target">
            <Selector
              id="svc-target"
              name="target"
              aria-label="Target"
              value={target}
              onValueChange={setTarget}
              minWidth={260}
              searchable={false}
              options={targetOptions}
              footer={
                <Link href="/app/marketplace?category=targets" className="text-con-fg2 transition-colors duration-150 hover:text-con-fg">
                  More deploy targets in the Marketplace
                </Link>
              }
            />
          </FormField>
          <FormField label="Cluster" htmlFor="svc-cluster">
            <input
              key={`c:${target}`}
              id="svc-cluster"
              name="cluster"
              maxLength={120}
              defaultValue={target === "simulated" ? "" : clusterDefault}
              disabled={target === "simulated"}
              placeholder={target === "simulated" ? "n/a" : "prod-eu-1"}
              className={`${inputClass} font-mono`}
            />
          </FormField>
          <FormField label="Namespace" htmlFor="svc-ns">
            <input
              key={`n:${target}`}
              id="svc-ns"
              name="namespace"
              maxLength={120}
              defaultValue={target === "simulated" ? "" : nsDefault}
              disabled={target === "simulated"}
              placeholder={target === "simulated" ? "n/a" : "checkout"}
              className={`${inputClass} font-mono`}
            />
          </FormField>
        </div>
        <label className="flex items-start gap-2.5 text-[13px] text-con-fg2">
          <input type="checkbox" name="critical" defaultChecked={initial.critical} className="mt-0.5 h-3.5 w-3.5 accent-[#ededed]" />
          <span>
            Critical service
            <span className="block text-[12px] text-con-fg3">Changes touching it score higher risk and get slower rollouts.</span>
          </span>
        </label>
        <div className="flex items-center justify-between gap-3 border-t border-con-line pt-4">
          <FormStatus error={state?.error} />
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={buttonClass.primary}>
              {pending && <Spinner />}
              {mode === "create" ? "Create service" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
