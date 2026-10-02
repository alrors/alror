"use client"; // Error boundaries must be Client Components.

import { RouteError, type RouteErrorProps } from "@/components/errors/route-error";

// Database and cache outages render the "workspace unavailable" screen (the kind
// travels in the error digest, see src/lib/error-kind.ts); anything else gets a
// calm retry screen with the error reference.
export default function ErrorBoundary(props: RouteErrorProps) {
  return <RouteError {...props} scope="console" />;
}
