import { SkeletonHeader, SkeletonPage, SkeletonTable } from "@/components/console/shell-skeleton";

/** Deployments list: header with filters and a paginated table. */
export default function Loading() {
  return (
    <SkeletonPage label="deployments">
      <SkeletonHeader actions={2} />
      <SkeletonTable rows={10} cols={6} />
    </SkeletonPage>
  );
}
