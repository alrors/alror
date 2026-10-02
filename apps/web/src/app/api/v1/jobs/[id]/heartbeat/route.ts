import { authorize, readJson, route } from "@/lib/server/api/http";
import { HeartbeatBody } from "@/lib/server/api/schemas";
import { heartbeatJob } from "@/lib/server/data/jobs";

type Ctx = { params: Promise<{ id: string }> };

// Extends the lease on a claimed job (alror runner calls it every 30 s).
// 409 means the lease was lost: the runner must stop and must not finish the job.
export const POST = route<Ctx>(async (req, { params }) => {
  const { ctx } = await authorize(req, "jobs:run");
  const { id } = await params;
  const body = await readJson(req, HeartbeatBody);
  return Response.json(await heartbeatJob(ctx, id, body.worker ?? body.runner));
});
