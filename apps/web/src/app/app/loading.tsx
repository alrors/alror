import { Bone, SkeletonPage } from "@/components/console/shell-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="oversight" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-5 py-2">
        <div className="space-y-3">
          <Bone className="h-3 w-36" />
          <Bone className="h-9 w-48" />
          <Bone className="h-3 w-[min(320px,75vw)]" />
        </div>
        <div className="flex gap-2">
          <Bone className="h-9 w-20" />
          <Bone className="h-9 w-36" />
        </div>
      </div>
      <div className="space-y-2.5">
        <div className="flex justify-between gap-4">
          <Bone className="h-4 w-20" />
          <Bone className="h-3 w-48" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-con-line bg-con-panel px-4 py-3.5">
              <Bone className="h-3 w-28" />
              <Bone className="h-7 w-14" />
              <Bone className="h-3 w-32" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {[4, 5].map((rows, i) => (
          <div key={i} className="rounded-lg border border-con-line bg-con-panel p-5">
            <Bone className="mb-5 h-4 w-28" />
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className="space-y-2.5 border-t border-con-line py-4">
                <Bone className="h-4 w-56" />
                <Bone className="h-3 w-full" />
                <Bone className="h-6 w-40" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
