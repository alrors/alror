import { Bone, SkeletonPage } from "@/components/console/shell-skeleton";

/** Setup checklist: title, progress bar and five steps. */
export default function Loading() {
  return (
    <SkeletonPage label="setup checklist" className="mx-auto max-w-[860px]">
      <div className="space-y-3">
        <Bone className="h-8 w-64" />
        <Bone className="h-4 w-80 max-w-full" />
        <Bone className="h-1.5 w-full rounded-full" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-4 rounded-lg border border-con-line bg-con-panel p-5">
            <Bone className="h-7 w-7 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2.5">
              <Bone className="h-4 w-40" />
              <Bone className="h-3.5 w-[80%]" />
              {i < 2 && <Bone className="h-10 w-full" />}
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
