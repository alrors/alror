import { SkeletonHeader, SkeletonPage, SkeletonTable } from "@/components/console/shell-skeleton";

/** Jobs: header and the job queue table. */
export default function Loading() {
  return (
    <SkeletonPage label="jobs">
      <SkeletonHeader actions={0} />
      <SkeletonTable rows={10} cols={6} />
    </SkeletonPage>
  );
}
