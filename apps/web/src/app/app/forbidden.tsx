import { AccessDenied } from "@/components/console/access-denied";

// Rendered by forbidden() from next/navigation inside the console. forbidden()
// needs `experimental.authInterrupts` in next.config.ts; until that flag is on,
// pages render <AccessDenied> directly (see the settings pages).
export default function Forbidden() {
  return (
    <>
      <title>No access · Alror console</title>
      <AccessDenied />
    </>
  );
}
