import { Bone, SkeletonHeader, SkeletonPage } from "@/components/console/shell-skeleton";

function CardBone({ tall }: { tall?: boolean }) {
  return (
    <div className="rounded-lg border border-con-line bg-con-panel p-4">
      <div className="flex items-start gap-3">
        <Bone className={tall ? "h-12 w-12 rounded-xl" : "h-10 w-10 rounded-lg"} />
        <div className="flex-1 space-y-2 pt-0.5">
          <Bone className="h-4 w-28" />
          <Bone className="h-3 w-20" />
        </div>
      </div>
      <Bone className="mt-4 h-3 w-full" />
      <Bone className="mt-2 h-3 w-4/5" />
      <Bone className="mt-4 h-5 w-20 rounded-full" />
      <div className="mt-3 border-t border-con-line pt-3">
        <Bone className="h-3 w-24" />
      </div>
    </div>
  );
}

/** Marketplace: header, toolbar, featured row and the catalog grid. */
export default function Loading() {
  return (
    <SkeletonPage label="marketplace">
      <SkeletonHeader actions={0} />
      <div className="flex flex-wrap items-center gap-2">
        <Bone className="h-8 w-full max-w-xs" />
        <Bone className="h-8 w-44" />
        <Bone className="ml-auto h-8 w-80" />
      </div>
      <div className="space-y-3">
        <Bone className="h-3 w-20" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <CardBone key={i} tall />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Bone className="h-4 w-40" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <CardBone key={i} />
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
