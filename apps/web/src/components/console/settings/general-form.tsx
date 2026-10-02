"use client";

import { useActionState, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { saveGeneral } from "@/app/app/settings/actions";
import { FormField, FormStatus, buttonClass, inputClass } from "@/components/console/primitives";
import type { ActionResult } from "@/lib/console/action-types";

export function GeneralForm({ name, slug, canEdit }: { name: string; slug: string; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveGeneral, undefined);
  const [n, setN] = useState(name);
  const [s, setS] = useState(slug);
  const dirty = n.trim() !== name || s.trim() !== slug;
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Organization name" htmlFor="org-name">
          <input id="org-name" name="name" value={n} onChange={(e) => setN(e.target.value)} disabled={!canEdit} maxLength={80} required className={inputClass} />
        </FormField>
        <FormField
          label="Slug"
          htmlFor="org-slug"
          hint="Used as the project name in GET /config and in alror.yaml after alror config pull."
        >
          <input
            id="org-slug"
            name="slug"
            value={s}
            onChange={(e) => setS(e.target.value.toLowerCase())}
            disabled={!canEdit}
            maxLength={40}
            pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
            required
            spellCheck={false}
            className={`${inputClass} font-mono`}
          />
        </FormField>
      </div>
      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending || !dirty} className={buttonClass.primary}>
            {pending && <LoaderCircle size={14} className="animate-spin" />}
            Save changes
          </button>
          <FormStatus error={state?.error} message={!dirty ? state?.message : undefined} />
        </div>
      )}
    </form>
  );
}
