"use client";

import { useActionState } from "react";
import { changeRole } from "@/app/app/settings/actions";
import { Spinner } from "@/components/console/loader";
import { Selector } from "@/components/console/selector";
import { undoToast } from "@/components/console/shell-toast";
import type { ActionResult } from "@/lib/console/action-types";

const ROLES = [
  { value: "owner", label: "Owner", description: "Full control, including other owners." },
  { value: "admin", label: "Admin", description: "Manages people, keys and config." },
  { value: "member", label: "Member", description: "Can deploy and read everything." },
];

const roleName = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

/**
 * Role picker that saves on change, then offers Undo (re-submits the previous
 * role). Owners can grant owner; admins can manage admins and members.
 */
export function RoleSelect({ userId, role, canGrantOwner, label }: { userId: string; role: string; canGrantOwner: boolean; label: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, fd) => {
    const next = String(fd.get("role") ?? "");
    if (next === role) return prev;
    const r = await changeRole(prev, fd);
    if (r?.ok) {
      undoToast(`${label} is now ${roleName(next).toLowerCase()}`, () => {
        const undo = new FormData();
        undo.set("user", userId);
        undo.set("role", role);
        return changeRole(undefined, undo);
      });
    }
    return r;
  }, undefined);
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="user" value={userId} />
      <span className="inline-flex items-center gap-2">
        <Selector
          // Remount when the saved role changes (after Undo or a refresh) so the picker shows it.
          key={role}
          name="role"
          defaultValue={role}
          aria-label={`Role for ${label}`}
          disabled={pending}
          submitOnChange
          className="w-28"
          minWidth={260}
          align="end"
          searchable={false}
          options={ROLES.filter((r) => canGrantOwner || r.value !== "owner" || role === "owner").map((r) => ({
            ...r,
            disabled: r.value === "owner" && !canGrantOwner,
          }))}
        />
        {pending && <Spinner className="text-con-fg3" />}
      </span>
      {state?.error && <span className="max-w-[220px] text-[12px] text-con-bad">{state.error}</span>}
    </form>
  );
}
