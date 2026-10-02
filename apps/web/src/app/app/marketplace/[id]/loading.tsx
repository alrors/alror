import { Bone, SkeletonCard, SkeletonLines, SkeletonPage } from "@/components/console/shell-skeleton";

/** Marketplace item: logo and title, then the content column and the details panel. */
export default function Loading() {
  return (
    <SkeletonPage label="plugin">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <Bone className="h-12 w-12 rounded-xl" />
          <div className="space-y-2.5">
            <Bone className="h-8 w-56" />
            <Bone className="h-4 w-[min(420px,70vw)]" />
            <Bone className="h-5 w-40 rounded-full" />
          </div>
        </div>
        <div className="flex gap-2">
          <Bone className="h-8 w-24" />
          <Bone className="h-8 w-20" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <SkeletonCard>
            <SkeletonLines rows={5} />
          </SkeletonCard>
          <SkeletonCard>
            <SkeletonLines rows={3} />
          </SkeletonCard>
          <SkeletonCard />
        </div>
        <SkeletonCard>
          <SkeletonLines rows={7} />
        </SkeletonCard>
      </div>
    </SkeletonPage>
  );
}
