import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { AdminHeader } from "@/components/admin/kit";
import { AdminAction } from "@/components/admin/admin-action";
import { buttonClass, Card, EmptyState, Pill } from "@/components/console/primitives";
import { AddLectureForm, CourseSettingsForm } from "@/components/learn/admin-forms";
import { LectureRow } from "@/components/learn/lecture-row";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { ApiError } from "@/lib/server/errors";
import { adminCourse } from "@/lib/server/learn/store";
import { deleteCourseAction, publishCourseAction } from "../actions";

export const metadata: Metadata = { title: "Course" };

export default async function AdminLearnCourse({ params }: PageProps<"/admin/learn/[id]">) {
  const admin = await requirePlatformAdmin();
  const { id } = await params;
  const found = await adminCourse(admin, id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
  if (!found) notFound();
  const { course, lectures } = found;

  return (
    <div className="con-fade-up space-y-4">
      <Link href="/admin/learn" className="inline-flex items-center gap-1.5 text-[12px] text-con-fg3 hover:text-con-fg">
        <ArrowLeft size={13} />
        All courses
      </Link>
      <AdminHeader
        title={course.title}
        description={
          <span className="inline-flex items-center gap-2">
            {course.published ? <Pill tone="good">Published</Pill> : <Pill>Draft</Pill>}
            <span className="font-mono text-[12px] text-con-fg3">/learn/{course.slug}</span>
          </span>
        }
        actions={
          <>
            <Link href={`/learn/${course.slug}`} target="_blank" className={buttonClass.secondary}>
              <ExternalLink size={13} />
              Preview
            </Link>
            <AdminAction
              action={publishCourseAction}
              fields={{ course: course.id, publish: course.published ? "0" : "1" }}
              label={course.published ? "Unpublish course" : "Publish course"}
            />
          </>
        }
      />

      <Card title="Add a lecture" description="Paste a YouTube link. The video stays on YouTube; Alror only stores the link.">
        <AddLectureForm courseId={course.id} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Lectures" description={`${lectures.length} lecture${lectures.length === 1 ? "" : "s"}, in watch order.`} flush>
          {lectures.length === 0 ? (
            <EmptyState title="No lectures yet">Paste a YouTube link above to add the first one.</EmptyState>
          ) : (
            <ol>
              {lectures.map((l, i) => (
                <LectureRow key={l.id} lecture={l} index={i} count={lectures.length} courseSlug={course.slug} />
              ))}
            </ol>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Course details">
            <CourseSettingsForm course={course} />
          </Card>
          <Card title="Danger zone">
            <AdminAction
              action={deleteCourseAction}
              fields={{ course: course.id }}
              label="Delete course"
              confirm="Deletes the course and all its lectures."
              confirmLabel="Delete"
              tone="danger"
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
