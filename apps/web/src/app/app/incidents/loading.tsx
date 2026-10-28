import { SkeletonHeader, SkeletonKpis, SkeletonPage, SkeletonTable } from "@/components/console/shell-skeleton";

/** Incidents: header, status tiles and the incident table. */
export default function Loading() {
  return (
    <SkeletonPage label="incidents">
      <SkeletonHeader actions={1} />
      <SkeletonKpis count={3} />
      <SkeletonTable rows={8} cols={5} />
    </SkeletonPage>
  );
}
