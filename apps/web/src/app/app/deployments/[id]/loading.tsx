import { Bone, SkeletonCard, SkeletonChart, SkeletonHeader, SkeletonLines, SkeletonPage } from "@/components/console/shell-skeleton";

/** Deployment detail: rollout card, verdict charts and the event log beside summary, risk and actions. */
export default function Loading() {
  return (
    <SkeletonPage label="deployment">
      <SkeletonHeader actions={2} meta />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <SkeletonCard>
            <div className="space-y-4">
              <Bone className="h-2 w-full rounded-full" />
              <div className="flex justify-between">
                {Array.from({ length: 5 }, (_, i) => (
                  <Bone key={i} className="h-6 w-6 rounded-full" />
                ))}
              </div>
            </div>
          </SkeletonCard>
          <SkeletonCard>
            <div className="grid gap-4 xl:grid-cols-2">
              <SkeletonChart className="h-36" />
              <SkeletonChart className="h-36" />
            </div>
          </SkeletonCard>
          <SkeletonCard>
            <SkeletonLines rows={8} />
          </SkeletonCard>
        </div>
        <div className="space-y-6">
          <SkeletonCard>
            <div className="flex gap-2">
              <Bone className="h-8 w-24" />
              <Bone className="h-8 w-24" />
            </div>
          </SkeletonCard>
          <SkeletonCard>
            <div className="space-y-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex justify-between gap-4">
                  <Bone className="h-3.5 w-20" />
                  <Bone className="h-3.5 w-28" />
                </div>
              ))}
            </div>
          </SkeletonCard>
          <SkeletonCard>
            <Bone className="mx-auto h-28 w-28 rounded-full" />
          </SkeletonCard>
        </div>
      </div>
    </SkeletonPage>
  );
}
