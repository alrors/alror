import { Bone, SkeletonCard, SkeletonHeader, SkeletonPage, SkeletonTable } from "@/components/console/shell-skeleton";

/** Policies: header, the policy editor and the per-plan table. */
export default function Loading() {
  return (
    <SkeletonPage label="policies">
      <SkeletonHeader actions={1} />
      <SkeletonCard>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Bone className="h-3 w-28" />
              <Bone className="h-8 w-full" />
            </div>
          ))}
        </div>
      </SkeletonCard>
      <SkeletonTable rows={4} cols={5} toolbar={false} title />
    </SkeletonPage>
  );
}
