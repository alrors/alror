import { Bone, SkeletonCard, SkeletonPage } from "@/components/console/shell-skeleton";

/** Settings sub-page content (the settings header and nav stay rendered by the layout). */
export default function Loading() {
  return (
    <SkeletonPage label="settings">
      <SkeletonCard>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Bone className="h-3 w-28" />
            <Bone className="h-8 w-full" />
          </div>
          <div className="space-y-2">
            <Bone className="h-3 w-16" />
            <Bone className="h-8 w-full" />
          </div>
        </div>
      </SkeletonCard>
      <div className="grid gap-6 xl:grid-cols-2">
        <SkeletonCard>
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex justify-between gap-4">
                <Bone className="h-3.5 w-24" />
                <Bone className="h-3.5 w-32" />
              </div>
            ))}
          </div>
        </SkeletonCard>
        <SkeletonCard>
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Bone key={i} className="h-8 w-full" />
            ))}
          </div>
        </SkeletonCard>
      </div>
    </SkeletonPage>
  );
}
