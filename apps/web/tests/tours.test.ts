// Integration tests for the setup page and the guided tours, run against the
// live dev server (seeded database).
//
//   docker compose up -d && npm run db:migrate && npm run db:seed && npm run dev   (in another terminal)
//   npm run test:tours

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { TOURS } from "@/lib/console/tours";

const BASE = (process.env.ALROR_TEST_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.ALROR_TEST_SEED_PASSWORD || "alror-demo";

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.8.${Math.floor(Math.random() * 250)}.3` },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.equal(res.status, 200, `login failed for ${email}; run npm run db:seed`);
  return res.headers.getSetCookie().find((c) => c.startsWith("alror_sid="))!.split(";")[0];
}

const html = async (path: string, cookie: string) => {
  const res = await fetch(BASE + path, { headers: { cookie }, redirect: "manual" });
  assert.equal(res.status, 200, path);
  return res.text();
};

let admin = "";
let member = "";
before(async () => {
  admin = await login("admin@acme.test");
  member = await login("dev@acme.test");
});

describe("guided tours", () => {
  test("every tour step points at an anchor on its page", async () => {
    for (const t of TOURS) {
      const page = await html(t.href, admin);
      for (const s of t.steps) if (s.anchor) assert.ok(page.includes(`data-tour="${s.anchor}"`), `${t.id}: ${t.href} has no data-tour="${s.anchor}"`);
    }
  });

  test("tour ids are unique and every tour has a step", () => {
    assert.equal(new Set(TOURS.map((t) => t.id)).size, TOURS.length);
    for (const t of TOURS) assert.ok(t.steps.length > 0, t.id);
  });
});

describe("setup page", () => {
  test("shows the five steps with real values", async () => {
    const page = await html("/app/onboarding", admin);
    for (const title of ["Create an API key", "Connect", "Add a service", "Start a runner", "Ship a release"]) assert.ok(page.includes(title), title);
    assert.ok(page.includes("steps done"), "progress");
  });

  test("members see the steps without admin-only actions", async () => {
    const page = await html("/app/onboarding", member);
    assert.ok(page.includes("Ask an owner or admin"));
    assert.ok(!page.includes("(simulated)</button>"));
  });
});
