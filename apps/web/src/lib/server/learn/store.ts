import "server-only";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { youtubeId } from "@/lib/learn/youtube";
import { assertAdmin, type AdminCtx } from "../admin/access";
import { recordAdminAction } from "../admin/log";
import { db, type Tx } from "../db";
import { learnCourses, learnLectures } from "../db/schema";
import { invalid, notFound } from "../errors";

// Courses of YouTube lectures for /learn. Anyone can read what is published; platform
// admins see drafts and are the only ones who can change anything. Every write
// is recorded in the instance admin log (Audit page).

export type Course = typeof learnCourses.$inferSelect;
export type Lecture = typeof learnLectures.$inferSelect;
export type CourseCard = Course & { lectures: number; firstLecture: string | null; thumb: string | null };

const TITLE_MAX = 160;
const TEXT_MAX = 20_000;

export function slugify(s: string): string {
  const slug = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

function cleanTitle(t: string): string {
  const v = t.trim().replace(/\s+/g, " ");
  if (!v) throw invalid("Give it a title.");
  if (v.length > TITLE_MAX) throw invalid(`Keep the title under ${TITLE_MAX} characters.`);
  return v;
}

function cleanText(t: string): string {
  const v = t.replace(/\r\n/g, "\n").trim();
  if (v.length > TEXT_MAX) throw invalid("That text is too long.");
  return v;
}

async function uniqueSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  for (let i = 1; i < 500; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    if (!(await taken(s))) return s;
  }
  throw invalid("Could not find a free URL for that title.");
}

const log = (admin: AdminCtx, action: string, target: string, meta?: Record<string, unknown>) =>
  recordAdminAction(admin, { action: `admin.learn.${action}`, target, orgs: [], meta });

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Course cards for /learn (published only unless `drafts`). */
export async function listCourses(opts: { drafts?: boolean } = {}): Promise<CourseCard[]> {
  const courses = await db
    .select()
    .from(learnCourses)
    .where(opts.drafts ? undefined : eq(learnCourses.published, true))
    .orderBy(asc(learnCourses.position), asc(learnCourses.createdAt));
  if (!courses.length) return [];
  const lectures = await db
    .select({
      courseId: learnLectures.courseId,
      slug: learnLectures.slug,
      youtubeId: learnLectures.youtubeId,
    })
    .from(learnLectures)
    .where(opts.drafts ? undefined : eq(learnLectures.published, true))
    .orderBy(asc(learnLectures.position), asc(learnLectures.createdAt));
  return courses.map((c) => {
    const own = lectures.filter((l) => l.courseId === c.id);
    const yt = own.find((l) => l.youtubeId)?.youtubeId;
    return {
      ...c,
      lectures: own.length,
      firstLecture: own[0]?.slug ?? null,
      thumb: yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null,
    };
  });
}

/** One course and its lectures in order, or null when it is missing or not visible. */
export async function courseOutline(slug: string, opts: { drafts?: boolean } = {}): Promise<{ course: Course; lectures: Lecture[] } | null> {
  const [course] = await db.select().from(learnCourses).where(eq(learnCourses.slug, slug)).limit(1);
  if (!course || (!opts.drafts && !course.published)) return null;
  const lectures = await db
    .select()
    .from(learnLectures)
    .where(opts.drafts ? eq(learnLectures.courseId, course.id) : and(eq(learnLectures.courseId, course.id), eq(learnLectures.published, true)))
    .orderBy(asc(learnLectures.position), asc(learnLectures.createdAt));
  return { course, lectures };
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

export async function adminCourses(admin: AdminCtx) {
  assertAdmin(admin);
  const courses = await db.select().from(learnCourses).orderBy(asc(learnCourses.position), asc(learnCourses.createdAt));
  const counts = await db
    .select({
      courseId: learnLectures.courseId,
      total: count(),
      live: sql<number>`count(*) filter (where ${learnLectures.published})`.mapWith(Number),
    })
    .from(learnLectures)
    .groupBy(learnLectures.courseId);
  const by = new Map(counts.map((c) => [c.courseId, c]));
  return courses.map((c) => ({ ...c, total: by.get(c.id)?.total ?? 0, live: by.get(c.id)?.live ?? 0 }));
}

export async function adminCourse(admin: AdminCtx, id: string): Promise<{ course: Course; lectures: Lecture[] }> {
  assertAdmin(admin);
  const course = await courseById(id);
  const lectures = await db
    .select()
    .from(learnLectures)
    .where(eq(learnLectures.courseId, id))
    .orderBy(asc(learnLectures.position), asc(learnLectures.createdAt));
  return { course, lectures };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function courseById(id: string): Promise<Course> {
  if (!UUID.test(id)) throw notFound("Course not found.");
  const [c] = await db.select().from(learnCourses).where(eq(learnCourses.id, id)).limit(1);
  if (!c) throw notFound("Course not found.");
  return c;
}

async function lectureById(id: string): Promise<Lecture> {
  if (!UUID.test(id)) throw notFound("Lecture not found.");
  const [l] = await db.select().from(learnLectures).where(eq(learnLectures.id, id)).limit(1);
  if (!l) throw notFound("Lecture not found.");
  return l;
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

const courseSlugTaken = (except?: string) => async (s: string) => {
  const [r] = await db.select({ id: learnCourses.id }).from(learnCourses).where(eq(learnCourses.slug, s)).limit(1);
  return Boolean(r && r.id !== except);
};

export async function createCourse(admin: AdminCtx, input: { title: string; summary: string }): Promise<Course> {
  assertAdmin(admin);
  const title = cleanTitle(input.title);
  const slug = await uniqueSlug(slugify(title), courseSlugTaken());
  const [last] = await db.select({ p: learnCourses.position }).from(learnCourses).orderBy(desc(learnCourses.position)).limit(1);
  const [c] = await db
    .insert(learnCourses)
    .values({ title, slug, summary: cleanText(input.summary), position: (last?.p ?? -1) + 1 })
    .returning();
  await log(admin, "course.create", c.slug);
  return c;
}

export async function updateCourse(admin: AdminCtx, id: string, input: { title: string; summary: string; slug: string }): Promise<Course> {
  assertAdmin(admin);
  const before = await courseById(id);
  const title = cleanTitle(input.title);
  const wanted = slugify(input.slug.trim() || title);
  if (wanted !== before.slug && (await courseSlugTaken(id)(wanted))) throw invalid(`Another course already uses /learn/${wanted}.`);
  const [c] = await db
    .update(learnCourses)
    .set({ title, summary: cleanText(input.summary), slug: wanted, updatedAt: new Date() })
    .where(eq(learnCourses.id, id))
    .returning();
  await log(admin, "course.update", c.slug, before.slug !== c.slug ? { from: before.slug } : undefined);
  return c;
}

export async function setCoursePublished(admin: AdminCtx, id: string, published: boolean): Promise<Course> {
  assertAdmin(admin);
  await courseById(id);
  const [c] = await db.update(learnCourses).set({ published, updatedAt: new Date() }).where(eq(learnCourses.id, id)).returning();
  await log(admin, published ? "course.publish" : "course.unpublish", c.slug);
  return c;
}

export async function deleteCourse(admin: AdminCtx, id: string): Promise<Course> {
  assertAdmin(admin);
  const c = await courseById(id);
  await db.delete(learnCourses).where(eq(learnCourses.id, id));
  await log(admin, "course.delete", c.slug);
  return c;
}

export async function moveCourse(admin: AdminCtx, id: string, dir: "up" | "down"): Promise<void> {
  assertAdmin(admin);
  const rows = await db.select({ id: learnCourses.id, p: learnCourses.position }).from(learnCourses).orderBy(asc(learnCourses.position), asc(learnCourses.createdAt));
  await swap(rows, id, dir, (tx, rid, p) => tx.update(learnCourses).set({ position: p }).where(eq(learnCourses.id, rid)));
}

/** Swaps a row with its neighbour and rewrites positions as 0..n-1. */
async function swap(
  rows: { id: string; p: number }[],
  id: string,
  dir: "up" | "down",
  write: (tx: Tx, id: string, position: number) => Promise<unknown>,
): Promise<void> {
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0) throw notFound();
  if (j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await db.transaction(async (tx) => {
    for (const [k, r] of rows.entries()) if (r.p !== k) await write(tx, r.id, k);
  });
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

const lectureSlugTaken = (courseId: string, except?: string) => async (s: string) => {
  const [r] = await db
    .select({ id: learnLectures.id })
    .from(learnLectures)
    .where(and(eq(learnLectures.courseId, courseId), eq(learnLectures.slug, s)))
    .limit(1);
  return Boolean(r && r.id !== except);
};

async function nextLecturePosition(courseId: string): Promise<number> {
  const [last] = await db
    .select({ p: learnLectures.position })
    .from(learnLectures)
    .where(eq(learnLectures.courseId, courseId))
    .orderBy(desc(learnLectures.position))
    .limit(1);
  return (last?.p ?? -1) + 1;
}

/** The video title from YouTube's public oEmbed endpoint, or null. */
async function youtubeTitle(id: string): Promise<string | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { title?: unknown };
    return typeof j.title === "string" && j.title.trim() ? j.title.trim().slice(0, TITLE_MAX) : null;
  } catch {
    return null;
  }
}

export async function createLecture(
  admin: AdminCtx,
  courseId: string,
  input: { url: string; title: string; description: string; publish: boolean },
): Promise<Lecture> {
  assertAdmin(admin);
  const course = await courseById(courseId);
  const yt = youtubeId(input.url);
  if (!yt) throw invalid("That does not look like a YouTube link.");
  const title = cleanTitle(input.title.trim() || (await youtubeTitle(yt)) || "");
  const slug = await uniqueSlug(slugify(title), lectureSlugTaken(courseId));
  const [l] = await db
    .insert(learnLectures)
    .values({
      courseId,
      slug,
      title,
      description: cleanText(input.description),
      youtubeId: yt,
      published: input.publish,
      position: await nextLecturePosition(courseId),
    })
    .returning();
  await log(admin, "lecture.create", `${course.slug}/${l.slug}`, { youtube_id: yt });
  return l;
}

export async function updateLecture(
  admin: AdminCtx,
  id: string,
  input: { title: string; description: string; youtube?: string },
): Promise<Lecture> {
  assertAdmin(admin);
  const before = await lectureById(id);
  const title = cleanTitle(input.title);
  const patch: Partial<Lecture> = { title, description: cleanText(input.description), updatedAt: new Date() };
  if (before.title !== title) patch.slug = await uniqueSlug(slugify(title), lectureSlugTaken(before.courseId, id));
  if (input.youtube?.trim()) {
    const yt = youtubeId(input.youtube);
    if (!yt) throw invalid("That does not look like a YouTube link.");
    patch.youtubeId = yt;
  }
  const [l] = await db.update(learnLectures).set(patch).where(eq(learnLectures.id, id)).returning();
  await log(admin, "lecture.update", l.slug);
  return l;
}

export async function setLecturePublished(admin: AdminCtx, id: string, published: boolean): Promise<Lecture> {
  assertAdmin(admin);
  await lectureById(id);
  const [l] = await db.update(learnLectures).set({ published, updatedAt: new Date() }).where(eq(learnLectures.id, id)).returning();
  await log(admin, published ? "lecture.publish" : "lecture.unpublish", l.slug);
  return l;
}

export async function deleteLecture(admin: AdminCtx, id: string): Promise<Lecture> {
  assertAdmin(admin);
  const l = await lectureById(id);
  await db.delete(learnLectures).where(eq(learnLectures.id, id));
  await log(admin, "lecture.delete", l.slug);
  return l;
}

export async function moveLecture(admin: AdminCtx, id: string, dir: "up" | "down"): Promise<void> {
  assertAdmin(admin);
  const start = await lectureById(id);
  const rows = await db
    .select({ id: learnLectures.id, p: learnLectures.position })
    .from(learnLectures)
    .where(eq(learnLectures.courseId, start.courseId))
    .orderBy(asc(learnLectures.position), asc(learnLectures.createdAt));
  await swap(rows, id, dir, (tx, rid, p) => tx.update(learnLectures).set({ position: p }).where(eq(learnLectures.id, rid)));
}
