import { Bone, SkeletonChart, SkeletonPage } from "@/components/console/shell-skeleton";

const panel = "rounded-lg border border-con-line bg-con-panel";

function PanelHead({ w = "w-32", aside = "w-16" }: { w?: string; aside?: string }) {
  return (
    <div className="flex items-center justify-between px-5 pb-1 pt-4">
      <Bone className={`h-4 ${w}`} />
      <Bone className={`h-3 ${aside}`} />
    </div>
  );
}

/** Overview board: header and command row, release pulse with the health panel, lanes, service tiles, activity and the side widgets. */
export default function Loading() {
  return (
    <SkeletonPage label="overview" className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2.5">
          <Bone className="h-4 w-40" />
          <Bone className="h-7 w-44" />
          <Bone className="h-4 w-[min(340px,80vw)]" />
        </div>
        <div className="flex gap-2">
          <Bone className="h-8 w-[132px]" />
          <Bone className="h-8 w-28" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {[72, 104, 80, 108, 68].map((w, i) => (
          <Bone key={i} className="h-7" style={{ width: w }} />
        ))}
      </div>

      {/* Hero */}
      <div className="flex flex-col gap-5 xl:flex-row">
        <div className={`${panel} min-w-0 flex-1`}>
          <PanelHead />
          <div className="px-5 pb-5 pt-3">
            <div className="mb-5 flex items-end gap-8">
              <Bone className="h-9 w-16" />
              <Bone className="h-8 w-56" />
            </div>
            <SkeletonChart className="h-[196px]" />
          </div>
        </div>
        <div className={`${panel} grid gap-px overflow-hidden bg-con-line sm:grid-cols-2 xl:w-[340px] xl:grid-cols-1`}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-end justify-between gap-4 bg-con-panel px-5 py-4">
              <div className="space-y-2">
                <Bone className="h-3 w-28" />
                <Bone className="h-6 w-20" />
                <Bone className="h-3 w-24" />
              </div>
              <Bone className="h-8 w-[104px]" />
            </div>
          ))}
        </div>
      </div>

      {/* Board */}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <div className={panel}>
            <PanelHead w="w-28" />
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="grid gap-4 border-t border-con-row px-5 py-4 lg:grid-cols-[1.1fr_2fr_auto]">
                <div className="space-y-2">
                  <Bone className="h-4 w-36" />
                  <Bone className="h-3 w-48" />
                </div>
                <div className="space-y-2.5">
                  <Bone className="h-3 w-40" />
                  <Bone className="h-1.5 w-full" />
                </div>
                <Bone className="h-7 w-40" />
              </div>
            ))}
          </div>
          <div className={panel}>
            <PanelHead w="w-28" aside="w-52" />
            <div className="grid gap-3 px-5 pb-5 pt-3 sm:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="space-y-3 rounded-md border border-con-line bg-con-bg p-3.5">
                  <Bone className="h-3.5 w-28" />
                  <Bone className="h-3 w-20" />
                  <div className="flex items-end justify-between">
                    <Bone className="h-6 w-24" />
                    <Bone className="h-6 w-20" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="min-w-0 space-y-5">
          {[4, 2, 3].map((rows, i) => (
            <div key={i} className={panel}>
              <PanelHead w="w-24" aside="w-10" />
              <div className="space-y-3 px-5 pb-5 pt-3">
                {Array.from({ length: rows }, (_, r) => (
                  <Bone key={r} className="h-9 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
