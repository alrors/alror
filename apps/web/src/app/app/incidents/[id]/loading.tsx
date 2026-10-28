import { Bone, SkeletonCard, SkeletonHeader, SkeletonLines, SkeletonPage } from "@/components/console/shell-skeleton";

/** Incident detail: the most likely change, ranked candidates, alert summary and auto-rollback rules. */
export default function Loading() {
  return (
    <SkeletonPage label="incident">
      <SkeletonHeader actions={1} meta />
      <SkeletonCard title={false}>
        <div className="flex items-center justify-between gap-4">
          <SkeletonLines rows={2} className="flex-1" />
          <Bone className="h-8 w-28" />
        </div>
      </SkeletonCard>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <SkeletonCard>
          <SkeletonLines rows={10} />
        </SkeletonCard>
        <div className="space-y-6">
          <SkeletonCard>
            <SkeletonLines rows={6} />
          </SkeletonCard>
          <SkeletonCard>
            <SkeletonLines rows={5} />
          </SkeletonCard>
        </div>
      </div>
    </SkeletonPage>
  );
}
