"use client";

import { useActionState, useId } from "react";
import { saveRepositoryPolicy } from "@/app/app/github/actions";
import { buttonClass, FormField, FormStatus, inputClass, selectClass } from "@/components/console/primitives";
import type { RepositoryView } from "@/lib/server/github/types";
import { cn } from "@/lib/site";

export const modeLabel = { observe: "Observe", review: "Require review", auto_merge: "Auto-merge" };

export function PolicyForm({ repository, admin }: { repository: RepositoryView; admin: boolean }) {
  const [result, action, pending] = useActionState(saveRepositoryPolicy, undefined);
  const id = useId();
  const policy = repository.policy;
  const textFields = [
    { name: "allowedPaths", label: "Eligible paths", hint: "One glob per line. Only changes within these paths can qualify for auto-merge.", value: policy.allowedPaths.join("\n") },
    { name: "protectedPaths", label: "Protected paths", hint: "Changes matching these paths require human review.", value: policy.protectedPaths.join("\n") },
    { name: "requiredChecks", label: "Required checks", hint: "One exact check name | GitHub App ID per line. The ID pins each check to its trusted provider.", value: policy.requiredChecks.map((c) => `${c.name} | ${c.appId}`).join("\n") },
    { name: "reviewers", label: "Reviewers", hint: "One GitHub username per line, without @.", value: policy.reviewers.join("\n") },
  ];
  return (
    <form action={action} className="space-y-5 border-t border-con-line pt-5">
      <input type="hidden" name="repositoryId" value={repository.id} />
      <fieldset disabled={!admin || pending} className="min-w-0 space-y-5">
        <legend className="sr-only">Policy for {repository.fullName}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Automation mode" htmlFor={`${id}-mode`} hint="Observe reports decisions. Require review enforces the gate. Auto-merge can merge eligible pull requests.">
            <select id={`${id}-mode`} name="mode" defaultValue={policy.mode} className={cn(selectClass, "w-full")}>
              {Object.entries(modeLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </FormField>
          <FormField label="Merge method" htmlFor={`${id}-mergeMethod`} hint="Used only when auto-merge is enabled and GitHub permits merging.">
            <select id={`${id}-mergeMethod`} name="mergeMethod" defaultValue={policy.mergeMethod} className={cn(selectClass, "w-full")}>
              <option value="squash">Squash</option><option value="merge">Merge commit</option><option value="rebase">Rebase</option>
            </select>
          </FormField>
          <FormField label="Maximum changed lines" htmlFor={`${id}-lines`}><input id={`${id}-lines`} name="maxChangedLines" type="number" min="1" required defaultValue={policy.maxChangedLines} className={inputClass} /></FormField>
          <FormField label="Maximum changed files" htmlFor={`${id}-files`}><input id={`${id}-files`} name="maxChangedFiles" type="number" min="1" required defaultValue={policy.maxChangedFiles} className={inputClass} /></FormField>
          {textFields.map((f) => <FormField key={f.name} label={f.label} hint={f.hint} htmlFor={`${id}-${f.name}`}><textarea id={`${id}-${f.name}`} name={f.name} defaultValue={f.value} rows={4} spellCheck={false} className={cn(inputClass, "h-auto resize-y py-2 font-mono text-[12px]")} /></FormField>)}
        </div>
        <div className="flex flex-col gap-3 text-[13px] text-con-fg2">
          <label className="flex items-center gap-2"><input type="checkbox" name="requireTests" defaultChecked={policy.requireTests} className="accent-white" />Require test changes for code changes</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="allowForks" defaultChecked={policy.allowForks} className="accent-white" />Allow fork pull requests to qualify</label>
        </div>
        {admin && <button type="submit" className={buttonClass.primary} disabled={pending}>{pending ? "Saving…" : "Save policy"}</button>}
      </fieldset>
      {!admin && <p className="text-[12px] text-con-fg3">Only workspace owners and admins can change this policy.</p>}
      <FormStatus error={result?.error} message={result?.message} />
    </form>
  );
}
