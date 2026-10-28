import { Bone, SkeletonPage } from "@/components/console/shell-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="overview" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-5 py-2">
        <div className="space-y-3">
          <Bone className="h-3 w-36" />
          <Bone className="h-9 w-64" />
          <Bone className="h-3 w-[min(350px,75vw)]" />
        </div>
        <div className="flex gap-2">
          <Bone className="h-9 w-24" />
          <Bone className="h-9 w-36" />
        </div>
      </div>
      <Bone className="h-11 w-full" />
      <div className="flex justify-between gap-4">
        <Bone className="h-9 w-48" />
        <Bone className="h-9 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="space-y-4 rounded-lg border border-con-line bg-con-panel p-5"
          >
            <Bone className="h-3 w-24" />
            <Bone className="h-8 w-20" />
            <Bone className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Bone className="h-4 w-32" />
        <Bone className="h-3 w-64" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.8fr_1fr]">
        {[2, 3].map((rows, i) => (
          <div
            key={i}
            className="rounded-lg border border-con-line bg-con-panel p-5"
          >
            <Bone className="mb-5 h-4 w-28" />
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className="space-y-3 border-t border-con-line py-5">
                <Bone className="h-4 w-48" />
                <Bone className="h-3 w-full" />
                <Bone className="h-2 w-2/3" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
