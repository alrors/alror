"use client";

/** GET form that submits when a select changes. Without JS the Apply button does it. */
export function FilterForm({ action, children, className }: { action: string; children: React.ReactNode; className?: string }) {
  return (
    <form
      action={action}
      method="get"
      className={className}
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === "SELECT") e.currentTarget.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
