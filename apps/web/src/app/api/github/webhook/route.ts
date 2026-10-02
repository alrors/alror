import { acceptWebhook } from "@/lib/server/github/webhook";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return await acceptWebhook(request); }
  catch { return Response.json({ error: "Webhook storage is unavailable. Redeliver this event after recovery." }, { status: 503 }); }
}
