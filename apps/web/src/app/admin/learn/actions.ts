"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, field, type ActionResult } from "@/lib/console/action-result";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import {
  createCourse,
  createLecture,
  deleteCourse,
  deleteLecture,
  moveCourse,
  moveLecture,
  setCoursePublished,
  setLecturePublished,
  updateCourse,
  updateLecture,
} from "@/lib/server/learn/store";

// /admin/learn server actions. Each re-checks the platform admin (404 otherwise);
// the store checks again and writes the instance admin log.

function refresh() {
  revalidatePath("/admin/learn", "layout");
  revalidatePath("/learn", "layout");
}

const dir = (fd: FormData) => (field(fd, "dir") === "up" ? "up" : "down");

export async function createCourseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  let id = "";
  try {
    id = (await createCourse(admin, { title: field(fd, "title"), summary: field(fd, "summary") })).id;
  } catch (e) {
    return actionError(e, "Could not create the course.");
  }
  refresh();
  redirect(`/admin/learn/${id}`);
}

export async function updateCourseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const c = await updateCourse(admin, field(fd, "course"), { title: field(fd, "title"), summary: field(fd, "summary"), slug: field(fd, "slug") });
    refresh();
    return { ok: true, message: `Saved. Live at /learn/${c.slug}.` };
  } catch (e) {
    return actionError(e, "Could not save the course.");
  }
}

export async function publishCourseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const c = await setCoursePublished(admin, field(fd, "course"), field(fd, "publish") === "1");
    refresh();
    return { ok: true, message: c.published ? `${c.title} is published.` : `${c.title} is now a draft.` };
  } catch (e) {
    return actionError(e, "Could not change the course.");
  }
}

export async function moveCourseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    await moveCourse(admin, field(fd, "course"), dir(fd));
    refresh();
    return undefined;
  } catch (e) {
    return actionError(e, "Could not move the course.");
  }
}

export async function deleteCourseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    await deleteCourse(admin, field(fd, "course"));
  } catch (e) {
    return actionError(e, "Could not delete the course.");
  }
  refresh();
  redirect("/admin/learn");
}

export async function addLectureAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const l = await createLecture(admin, field(fd, "course"), {
      url: field(fd, "url"),
      title: field(fd, "title"),
      description: field(fd, "description"),
      publish: field(fd, "publish") === "on",
    });
    refresh();
    return { ok: true, message: `Added "${l.title}"${l.published ? "" : " as a draft"}.` };
  } catch (e) {
    return actionError(e, "Could not add the lecture.");
  }
}

export async function updateLectureAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    await updateLecture(admin, field(fd, "lecture"), { title: field(fd, "title"), description: field(fd, "description"), youtube: field(fd, "url") });
    refresh();
    return { ok: true, message: "Lecture saved." };
  } catch (e) {
    return actionError(e, "Could not save the lecture.");
  }
}

export async function publishLectureAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const l = await setLecturePublished(admin, field(fd, "lecture"), field(fd, "publish") === "1");
    refresh();
    return { ok: true, message: l.published ? `"${l.title}" is published.` : `"${l.title}" is now a draft.` };
  } catch (e) {
    return actionError(e, "Could not change the lecture.");
  }
}

export async function moveLectureAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    await moveLecture(admin, field(fd, "lecture"), dir(fd));
    refresh();
    return undefined;
  } catch (e) {
    return actionError(e, "Could not move the lecture.");
  }
}

export async function deleteLectureAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const l = await deleteLecture(admin, field(fd, "lecture"));
    refresh();
    return { ok: true, message: `Deleted "${l.title}".` };
  } catch (e) {
    return actionError(e, "Could not delete the lecture.");
  }
}

/** Plain form actions for the up/down buttons (no toast needed). */
export async function moveLectureForm(fd: FormData): Promise<void> {
  await moveLectureAction(undefined, fd);
}

export async function moveCourseForm(fd: FormData): Promise<void> {
  await moveCourseAction(undefined, fd);
}
