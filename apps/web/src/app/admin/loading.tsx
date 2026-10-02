import { LoadingPanel } from "@/components/console/loader";

/** Shown inside the admin frame while a page's data loads. */
export default function Loading() {
  return <LoadingPanel label="Loading" detail="Reading instance data" className="min-h-[50vh]" />;
}
