import { PageLoader } from "@/components/console/loader";

// Shown while a top-level route loads, e.g. the console after signing in, before its shell is ready.
export default function Loading() {
  return <PageLoader />;
}
