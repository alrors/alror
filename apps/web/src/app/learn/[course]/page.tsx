import { notFound, redirect } from "next/navigation";
import { courseOutline } from "@/lib/server/learn/store";
import { viewerIsAdmin } from "@/lib/server/learn/viewer";

export const dynamic = "force-dynamic";

/** A course opens on its first lecture. */
export default async function LearnCourse({ params }: PageProps<"/learn/[course]">) {
  const { course } = await params;
  const outline = await courseOutline(course, { drafts: await viewerIsAdmin() });
  if (!outline) notFound();
  const first = outline.lectures[0];
  if (!first) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 py-16 text-center sm:px-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{outline.course.title}</h1>
        <p className="mt-2 text-[14px] text-con-fg2">Lectures for this course are coming soon.</p>
      </main>
    );
  }
  redirect(`/learn/${outline.course.slug}/${first.slug}`);
}
