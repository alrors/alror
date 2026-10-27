import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LectureOutline, MarkWatched } from "@/components/learn/outline";
import { youtubeEmbed, youtubeThumb } from "@/lib/learn/youtube";
import { courseOutline } from "@/lib/server/learn/store";
import { viewerIsAdmin } from "@/lib/server/learn/viewer";
import { cn } from "@/lib/site";

export const dynamic = "force-dynamic";

async function load(params: PageProps<"/learn/[course]/[lecture]">["params"]) {
  const { course, lecture } = await params;
  const outline = await courseOutline(course, { drafts: await viewerIsAdmin() });
  const index = outline?.lectures.findIndex((l) => l.slug === lecture) ?? -1;
  if (!outline || index < 0) notFound();
  return { ...outline, index, lecture: outline.lectures[index] };
}

export async function generateMetadata({ params }: PageProps<"/learn/[course]/[lecture]">): Promise<Metadata> {
  const { course, lecture } = await load(params);
  return {
    title: `${lecture.title} · ${course.title}`,
    description: lecture.description.slice(0, 160) || course.summary.slice(0, 160) || undefined,
    openGraph: { images: [youtubeThumb(lecture.youtubeId)] },
  };
}

const navBtn =
  "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-con-line px-3 text-[13px] text-con-fg2 transition-colors hover:border-con-line-hover hover:text-con-fg";

export default async function LearnLecture({ params }: PageProps<"/learn/[course]/[lecture]">) {
  const { course, lectures, lecture, index } = await load(params);
  const prev = lectures[index - 1];
  const next = lectures[index + 1];
  const base = `/learn/${course.slug}`;

  return (
    <div className="mx-auto grid w-full max-w-[1400px] flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="order-2 border-t border-con-line lg:order-1 lg:border-r lg:border-t-0">
        <div className="lg:sticky lg:top-12 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto con-scroll">
          <div className="px-5 pb-3 pt-5">
            <Link href="/learn" className="text-[12px] text-con-fg3 hover:text-con-fg">
              All courses
            </Link>
            <h2 className="mt-1 text-[15px] font-semibold leading-snug">{course.title}</h2>
            <p className="mt-0.5 text-[12px] text-con-fg3">
              {lectures.length} lecture{lectures.length === 1 ? "" : "s"}
            </p>
          </div>
          <LectureOutline
            courseSlug={course.slug}
            active={lecture.slug}
            lectures={lectures.map((l) => ({ slug: l.slug, title: l.title, draft: !l.published }))}
          />
        </div>
      </aside>

      <main className="order-1 min-w-0 px-4 py-5 sm:px-8 sm:py-7 lg:order-2">
        <MarkWatched courseSlug={course.slug} lectureSlug={lecture.slug} />
        <div className="mx-auto max-w-[960px]">
          <div className="aspect-video overflow-hidden rounded-lg border border-con-line bg-black">
            <iframe
              key={lecture.id}
              src={youtubeEmbed(lecture.youtubeId)}
              title={lecture.title}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>

          <p className="mt-6 text-[12px] font-medium uppercase tracking-wide text-con-fg3">
            Lecture {index + 1} of {lectures.length}
            {!lecture.published && <span className="ml-2 text-con-warn">Draft</span>}
          </p>
          <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.02em]">{lecture.title}</h1>
          {lecture.description && (
            <div className="mt-4 whitespace-pre-line text-[14px] leading-relaxed text-con-fg2">{lecture.description}</div>
          )}

          <nav aria-label="Lectures" className="mt-8 flex items-center justify-between gap-3 border-t border-con-line pt-5">
            {prev ? (
              <Link href={`${base}/${prev.slug}`} className={navBtn}>
                <ChevronLeft size={15} className="shrink-0" />
                <span className="truncate">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={`${base}/${next.slug}`} className={cn(navBtn, "ml-auto border-con-line-hover text-con-fg")}>
                <span className="truncate">Next: {next.title}</span>
                <ChevronRight size={15} className="shrink-0" />
              </Link>
            )}
          </nav>
        </div>
      </main>
    </div>
  );
}
