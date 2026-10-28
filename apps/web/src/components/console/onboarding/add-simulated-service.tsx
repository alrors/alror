"use client";

import { Plus } from "lucide-react";
import { Spinner } from "@/components/console/loader";
import { buttonClass } from "@/components/console/primitives";
import { useActionToast, useRetryableAction } from "@/components/console/shell-toast";
import { createService, type ServiceResult } from "@/app/app/services/actions";

/** One click: a real service on the simulated target, so a first release needs no infrastructure. */
export function AddSimulatedService({ name }: { name: string }) {
  const [state, submit, pending, retry] = useRetryableAction<ServiceResult>(createService, undefined);
  useActionToast(state, { retry, success: `Added ${name} on the simulated target.` });
  return (
    <form action={submit}>
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="target" value="simulated" />
      <input type="hidden" name="paths" value={`services/${name}/`} />
      <button type="submit" disabled={pending} className={buttonClass.secondary}>
        {pending ? <Spinner size={13} /> : <Plus size={13} />}
        Add {name} (simulated)
      </button>
    </form>
  );
}
