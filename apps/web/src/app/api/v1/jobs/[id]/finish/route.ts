import { authorize, readJson, route } from "@/lib/server/api/http";
import { FinishBody } from "@/lib/server/api/schemas";
import { finishJob } from "@/lib/server/data/jobs";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, { params }) => {
  const { ctx } = await authorize(req, "jobs:run");
  const { id } = await params;
  const body = await readJson(req, FinishBody);
  return Response.json(await finishJob(ctx, id, { ...body, runner: body.worker ?? body.runner }));
});
