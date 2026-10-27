import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { AdminHeader, tableCell, tableHead } from "@/components/admin/kit";
import { AdminAction } from "@/components/admin/admin-action";
import { buttonClass, Card, EmptyState, Pill } from "@/components/console/primitives";
import { NewCourseForm } from "@/components/learn/admin-forms";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { adminCourses } from "@/lib/server/learn/store";
import { cn } from "@/lib/site";
import { moveCourseForm, publishCourseAction } from "./actions";

export const metadata: Metadata = { title: "Learn" };

const iconBtn = cn(buttonClass.secondary, "h-7 w-7 px-0");

export default async function AdminLearn() {
  const admin = await requirePlatformAdmin();
  const courses = await adminCourses(admin);

  return (
    <div className="con-fade-up space-y-4">
      <AdminHeader
        title="Learn"
        description="Courses of YouTube lectures served at /learn. Only platform admins can add, publish or reorder them; drafts are visible to admins only."
        actions={
          <Link href="/learn" target="_blank" className={buttonClass.secondary}>
            <ExternalLink size={13} />
            View /learn
          </Link>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Courses" description={`${courses.length} course${courses.length === 1 ? "" : "s"}, in the order shown on /learn.`} flush>
          {courses.length === 0 ? (
            <EmptyState title="No courses yet">Create one, then paste YouTube links into it.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-con-line">
                    <th className={tableHead}>Course</th>
                    <th className={cn(tableHead, "text-right")}>Lectures</th>
                    <th className={tableHead}>Status</th>
                    <th className={cn(tableHead, "text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((c, i) => (
                    <tr key={c.id} className="border-b border-con-line last:border-0">
                      <td className={tableCell}>
                        <Link href={`/admin/learn/${c.id}`} className="font-medium text-con-fg hover:underline">
                          {c.title}
                        </Link>
                        <p className="font-mono text-[11px] text-con-fg3">/learn/{c.slug}</p>
                      </td>
                      <td className={cn(tableCell, "text-right tabular-nums text-con-fg2")}>
                        {c.live}
                        {c.total > c.live && <span className="text-con-fg3"> / {c.total}</span>}
                      </td>
                      <td className={tableCell}>{c.published ? <Pill tone="good">Published</Pill> : <Pill>Draft</Pill>}</td>
                      <td className={cn(tableCell, "text-right")}>
                        <div className="inline-flex items-center gap-1.5">
                          <AdminAction
                            action={publishCourseAction}
                            fields={{ course: c.id, publish: c.published ? "0" : "1" }}
                            label={c.published ? "Unpublish" : "Publish"}
                            size="sm"
                          />
                          <form action={moveCourseForm} className="contents">
                            <input type="hidden" name="course" value={c.id} />
                            <button name="dir" value="up" disabled={i === 0} title="Move up" className={iconBtn}>
                              <ArrowUp size={13} />
                            </button>
                            <button name="dir" value="down" disabled={i === courses.length - 1} title="Move down" className={iconBtn}>
                              <ArrowDown size={13} />
                            </button>
                          </form>
                          <Link href={`/admin/learn/${c.id}`} className={cn(buttonClass.secondary, "h-7 px-2 text-[12px]")}>
                            Manage
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="New course">
          <NewCourseForm />
        </Card>
      </div>
    </div>
  );
}
