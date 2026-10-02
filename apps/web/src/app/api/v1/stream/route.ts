import { authorize, route } from "@/lib/server/api/http";
import { subscribeOrg } from "@/lib/server/redis";

// Server-sent events for the console: relays Redis org:<orgId>:events as
// `event: <type>` / `data: <json>`, with an observable heartbeat every 15 s.

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

export const GET = route(async (req) => {
  const { ctx } = await authorize(req, "deploy:read", { sessionOnly: true });
  const enc = new TextEncoder();
  let cleanup: (() => Promise<void>) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          void stop();
        }
      };
      const unsubscribe = await subscribeOrg(ctx.orgId, (type, data) => send(`event: ${type}\ndata: ${data}\n\n`));
      // Comments aren't delivered to EventSource listeners. A named event lets
      // the client detect a proxy that silently stops forwarding this stream.
      const heartbeat = setInterval(() => send(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`), HEARTBEAT_MS);
      const stop = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        req.signal.removeEventListener("abort", onAbort);
        await unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };
      const onAbort = () => void stop();
      cleanup = stop;
      req.signal.addEventListener("abort", onAbort);
      if (req.signal.aborted) return void stop();
      send(`retry: 5000\n: connected\n\n`);
    },
    async cancel() {
      await cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
