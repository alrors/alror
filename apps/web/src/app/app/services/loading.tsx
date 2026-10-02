import { SkeletonHeader, SkeletonPage, SkeletonTable } from "@/components/console/shell-skeleton";

/** Services list: header with actions and the services table. */
export default function Loading() {
  return (
    <SkeletonPage label="services">
      <SkeletonHeader actions={2} />
      <SkeletonTable rows={8} cols={6} />
    </SkeletonPage>
  );
}
