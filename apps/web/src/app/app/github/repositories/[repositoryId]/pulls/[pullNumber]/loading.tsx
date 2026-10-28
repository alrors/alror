import { Bone, SkeletonCard, SkeletonHeader, SkeletonLines, SkeletonPage } from "@/components/console/shell-skeleton";

/** Pull request decision: why, reasons and files, required checks, history by commit. */
export default function Loading() {
  return (
    <SkeletonPage label="pull request decision">
      <Bone className="h-4 w-40" />
      <SkeletonHeader actions={1} meta />
      <div className="space-y-4 rounded-lg border border-con-line bg-con-panel px-5 py-4">
        <Bone className="h-3 w-28" />
        <Bone className="h-4 w-[min(560px,90%)]" />
        <div className="grid gap-5 border-t border-con-line pt-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Bone className="h-3 w-24" />
              <Bone className="h-6 w-28" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard>
          <SkeletonLines rows={4} />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonLines rows={3} />
        </SkeletonCard>
      </div>
      <SkeletonCard>
        <SkeletonLines rows={5} />
      </SkeletonCard>
    </SkeletonPage>
  );
}
