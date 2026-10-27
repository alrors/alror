import type { Metadata } from "next";
import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { listCourses } from "@/lib/server/learn/store";
import { viewerIsAdmin } from "@/lib/server/learn/viewer";

export const metadata: Metadata = { title: "Learn" };
export const dynamic = "force-dynamic";

export default async function LearnIndex() {
  const admin = await viewerIsAdmin();
  const courses = await listCourses({ drafts: admin });

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Learn</h1>
      <p className="mt-1.5 max-w-xl text-[14px] text-con-fg2">Short lectures, in order. Pick a course and press play.</p>

      {courses.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-con-line px-6 py-16 text-center text-[14px] text-con-fg2">
          No courses published yet.
          {admin && (
            <>
              {" "}
              <Link href="/admin/learn" className="text-con-fg underline underline-offset-4">
                Add one
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <li key={c.id}>
              <Link
                href={`/learn/${c.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-lg border border-con-line bg-con-panel transition-colors hover:border-con-line-hover"
              >
                <div className="relative aspect-video bg-con-row">
                  {c.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumb} alt="" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" loading="lazy" />
                  ) : (
                    <div className="grid h-full place-items-center text-con-fg3">
                      <PlayCircle size={28} strokeWidth={1.4} />
                    </div>
                  )}
                  {!c.published && (
                    <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-con-warn">Draft</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h2 className="text-[15px] font-semibold leading-snug">{c.title}</h2>
                  {c.summary && <p className="mt-1 line-clamp-2 text-[13px] text-con-fg2">{c.summary}</p>}
                  <p className="mt-auto pt-3 text-[12px] text-con-fg3">
                    {c.lectures} lecture{c.lectures === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
