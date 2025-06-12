import { ExecutionContext } from "@cloudflare/workers-types";

export const streamSSE = (
  ctx: ExecutionContext,
  fn: (emit: (event: string, data?: object) => void) => Promise<void>
) => {
  const encoder = new TextEncoder();

  const response = new Response(
    new ReadableStream({
      start: (ctl) =>
        ctx.waitUntil(
          fn((event, data) =>
            ctl.enqueue(
              encoder.encode(
                [
                  `event: ${event}\n`,
                  data && `data: ${JSON.stringify(data)}\n\n`,
                ]
                  .filter(Boolean)
                  .join("")
              )
            )
          )
        ),
    }),
    {
      headers: Object.fromEntries([
        ["Cache-Control", "no-cache"],
        ["Connection", "keep-alive"],
        ["Content-Type", "text/event-stream"],
        ["Transfer-Encoding", "chunked"],
      ]),
    }
  );

  return response;
};
