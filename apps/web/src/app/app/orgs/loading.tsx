import { Bone, SkeletonPage } from "@/components/console/shell-skeleton";

/** Organizations: search and a grid of org cards. */
export default function Loading() {
  return (
    <SkeletonPage label="organizations" className="mx-auto max-w-[1100px]">
      <Bone className="h-8 w-64" />
      <div className="flex justify-between gap-3">
        <Bone className="h-8 w-72" />
        <Bone className="h-8 w-36" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-lg border border-con-line bg-con-panel p-5">
            <Bone className="h-10 w-10 rounded-md" />
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-24" />
              <Bone className="h-3 w-36" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
