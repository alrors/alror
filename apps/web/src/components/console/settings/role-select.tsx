"use client";

import { useActionState } from "react";
import { changeRole } from "@/app/app/settings/actions";
import { Spinner } from "@/components/console/loader";
import { Selector } from "@/components/console/selector";
import type { ActionResult } from "@/lib/console/action-types";

const ROLES = [
  { value: "owner", label: "Owner", description: "Full control, including other owners." },
  { value: "admin", label: "Admin", description: "Manages people, keys and config." },
  { value: "member", label: "Member", description: "Can deploy and read everything." },
];

/** Role picker that saves on change. Owners can grant owner; admins can manage admins and members. */
export function RoleSelect({ userId, role, canGrantOwner, label }: { userId: string; role: string; canGrantOwner: boolean; label: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(changeRole, undefined);
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="user" value={userId} />
      <span className="inline-flex items-center gap-2">
        <Selector
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
