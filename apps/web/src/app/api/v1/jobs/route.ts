import { authorize, parse, readJson, route } from "@/lib/server/api/http";
import { JobBody, JobStatusQuery } from "@/lib/server/api/schemas";
import { enqueueJob, listJobs } from "@/lib/server/data/jobs";

export const GET = route(async (req) => {
  const { ctx } = await authorize(req, "deploy:read");
  const status = parse(JobStatusQuery, req.nextUrl.searchParams.get("status") || undefined);
  return Response.json(await listJobs(ctx, { status }));
});

export const POST = route(async (req) => {
  const { ctx } = await authorize(req, "deploy:write");
  const body = await readJson(req, JobBody);
  return Response.json(await enqueueJob(ctx, body), { status: 201 });
});
