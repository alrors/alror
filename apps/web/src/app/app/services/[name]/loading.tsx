import { Bone, SkeletonCard, SkeletonChart, SkeletonHeader, SkeletonPage, SkeletonTable } from "@/components/console/shell-skeleton";

/** Service detail: header, facts grid beside a chart, then recent releases and jobs. */
export default function Loading() {
  return (
    <SkeletonPage label="service">
      <SkeletonHeader actions={2} meta />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 self-start sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Bone className="h-3 w-20" />
              <Bone className="h-5 w-32" />
            </div>
          ))}
        </div>
        <SkeletonCard>
          <SkeletonChart className="h-40" />
        </SkeletonCard>
      </div>
      <SkeletonTable rows={6} cols={5} toolbar={false} title />
      <SkeletonTable rows={3} cols={4} toolbar={false} title />
    </SkeletonPage>
  );
}
