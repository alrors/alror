import { SkeletonCard, SkeletonChart, SkeletonHeader, SkeletonKpis, SkeletonPage, SkeletonTable } from "@/components/console/shell-skeleton";

/** Insights: five KPI tiles, then paired chart cards. */
export default function Loading() {
  return (
    <SkeletonPage label="insights">
      <SkeletonHeader actions={1} />
      <SkeletonKpis count={5} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SkeletonCard>
          <SkeletonChart />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonChart />
        </SkeletonCard>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <SkeletonCard>
          <SkeletonChart className="h-40" />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonChart className="h-40" />
        </SkeletonCard>
      </div>
      <SkeletonTable rows={5} cols={4} toolbar={false} title />
    </SkeletonPage>
  );
}
