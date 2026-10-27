// Integration tests for /learn and /admin/learn, run against the live dev server and database.
//
//   docker compose up -d && npm run db:migrate && npm run db:seed && npm run dev   (in another terminal)
//   npm run test:learn
//
// Each run creates one course through the data layer (as the seed's platform
// admin) and deletes it at the end.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { toAdmin, type AdminCtx } from "@/lib/server/admin/access";
import { closeDb, db } from "@/lib/server/db";
import { learnCourses, users } from "@/lib/server/db/schema";
import {
  courseOutline,
  createCourse,
  createLecture,
  deleteCourse,
  deleteLecture,
  listCourses,
  moveLecture,
  setCoursePublished,
  setLecturePublished,
  updateLecture,
} from "@/lib/server/learn/store";
import { youtubeId } from "@/lib/learn/youtube";
import { closeRedis } from "@/lib/server/redis";

const BASE = (process.env.ALROR_TEST_URL || "http://localhost:3000").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ALROR_TEST_ADMIN_EMAIL || "admin@acme.test";
const MEMBER_EMAIL = process.env.ALROR_TEST_MEMBER_EMAIL || "dev@acme.test";
const SEED_PASSWORD = process.env.ALROR_TEST_SEED_PASSWORD || "alror-demo";
const RUN = randomBytes(4).toString("hex");

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.1` },
    body: JSON.stringify({ email, password: SEED_PASSWORD }),
  });
  assert.equal(res.status, 200, `login failed for ${email}; run npm run db:seed`);
  const c = res.headers.getSetCookie().find((x) => x.startsWith("alror_sid="));
  return c!.split(";")[0];
}

// Pages stream under the root loading boundary, so notFound() renders the 404
// screen (noindex) without changing the status code. Check content instead.
const hidden = (p: { status: number; html: string }) => p.status === 404 || (/noindex/.test(p.html) && !/youtube-nocookie/.test(p.html));

const page = async (path: string, cookie = "") => {
  const res = await fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), html: await res.text() };
};

let admin: AdminCtx;
let adminCookie = "";
let memberCookie = "";
let courseId = "";
let slug = "";

before(async () => {
  const [u] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  assert.ok(u, "seed admin missing; run npm run db:seed");
  admin = toAdmin({ user: { id: u.id, email: u.email, name: u.name } } as Parameters<typeof toAdmin>[0]);
  adminCookie = await login(ADMIN_EMAIL);
  memberCookie = await login(MEMBER_EMAIL);
});

after(async () => {
  if (courseId) await deleteCourse(admin, courseId).catch(() => {});
  await closeDb();
  await closeRedis();
});

describe("youtubeId", () => {
  test("accepts common link shapes", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
      "youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://m.youtube.com/live/dQw4w9WgXcQ",
      "dQw4w9WgXcQ",
    ])
      assert.equal(youtubeId(u), "dQw4w9WgXcQ", u);
  });
  test("rejects other links", () => {
    for (const u of ["https://vimeo.com/123", "https://evil.com/watch?v=dQw4w9WgXcQ", "not a link", "https://youtu.be/short"]) assert.equal(youtubeId(u), null, u);
  });
});

describe("learn", () => {
  test("a regular user cannot change anything", async () => {
    const fake = { ...admin, email: MEMBER_EMAIL };
    await assert.rejects(createCourse(fake, { title: "nope", summary: "" }), /Not found/);
  });

  test("admin creates a draft course with lectures from links", async () => {
    const c = await createCourse(admin, { title: `Test course ${RUN}`, summary: "Line one" });
    courseId = c.id;
    slug = c.slug;
    assert.equal(c.published, false);
    const a = await createLecture(admin, c.id, { url: "https://youtu.be/dQw4w9WgXcQ", title: "First", description: "Notes", publish: true });
    const b = await createLecture(admin, c.id, { url: "https://www.youtube.com/watch?v=9bZkp7q19f0", title: "First", description: "", publish: false });
    assert.equal(a.slug, "first");
    assert.equal(b.slug, "first-2");
    await assert.rejects(createLecture(admin, c.id, { url: "https://vimeo.com/1", title: "x", description: "", publish: true }), /YouTube/);
  });

  test("drafts stay hidden until published", async () => {
    assert.equal(await courseOutline(slug), null);
    assert.ok(!(await listCourses()).some((c) => c.id === courseId));
    assert.ok(hidden(await page(`/learn/${slug}`)));
    assert.ok(hidden(await page(`/learn/${slug}/first`)));
    assert.ok(hidden(await page(`/learn/${slug}/first`, memberCookie)));
    // Admins can preview drafts.
    const p = await page(`/learn/${slug}/first`, adminCookie);
    assert.equal(p.status, 200);
    assert.match(p.html, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);

    await setCoursePublished(admin, courseId, true);
    const o = await courseOutline(slug);
    assert.deepEqual(o?.lectures.map((l) => l.slug), ["first"]);
    const list = await page("/learn");
    assert.match(list.html, new RegExp(`Test course ${RUN}`));
    const r = await page(`/learn/${slug}`);
    assert.ok(r.status === 307 || /\/first/.test(r.html), "course page should open the first lecture");
    assert.ok((await page(`/learn/${slug}/first`)).html.includes("embed/dQw4w9WgXcQ"));
    assert.ok(hidden(await page(`/learn/${slug}/first-2`)));
  });

  test("reorder, edit, unpublish and delete lectures", async () => {
    const all = (await courseOutline(slug, { drafts: true }))!.lectures;
    await setLecturePublished(admin, all[1].id, true);
    await moveLecture(admin, all[1].id, "up");
    const moved = (await courseOutline(slug))!.lectures.map((l) => l.slug);
    assert.deepEqual(moved, ["first-2", "first"]);
    const u = await updateLecture(admin, all[1].id, { title: "Intro", description: "Hello", youtube: "https://youtu.be/dQw4w9WgXcQ" });
    assert.equal(u.slug, "intro");
    assert.equal(u.youtubeId, "dQw4w9WgXcQ");
    await deleteLecture(admin, all[0].id);
    assert.deepEqual((await courseOutline(slug))!.lectures.map((l) => l.slug), ["intro"]);
  });

  test("the admin pages are admin-only", async () => {
    assert.equal((await page("/admin/learn")).status, 404);
    assert.equal((await page("/admin/learn", memberCookie)).status, 404);
    const p = await page(`/admin/learn/${courseId}`, adminCookie);
    assert.equal(p.status, 200);
    assert.match(p.html, /Add a lecture/);
  });

  test("deleting a course removes it", async () => {
    await deleteCourse(admin, courseId);
    const [gone] = await db.select().from(learnCourses).where(eq(learnCourses.id, courseId));
    assert.equal(gone, undefined);
    courseId = "";
  });
});
