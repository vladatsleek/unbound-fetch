import { DurableObject } from "cloudflare:workers";

export class UnboundFetch extends DurableObject {
  server: WebSocket | null = null;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  send(event: {
    id: string;
    event: "headers" | "body" | "end";
    data?: unknown;
  }) {
    this.server?.send(JSON.stringify(event));
  }

  fetch() {
    const [webSocket, server] = Object.values(new WebSocketPair());
    Object.assign(this, { server });

    const controllers = new Map<string, AbortController>();

    server.addEventListener("message", ({ data }) => {
      const [id, req] = JSON.parse(data) as [
        string,
        IRequestParams | IAbortSignal
      ];

      if (req === "abort") {
        controllers.get(id)?.abort();
        controllers.delete(id);
        return;
      }

      if (req.init?.signal) {
        const controller = new AbortController();
        controllers.set(id, controller);
        req.init.signal = controller.signal;
      }

      fetch(req.input, {
        ...req.init,
        headers: new Headers(req.init?.headers),
      })
        .then(async (res) => {
          this.send({
            id,
            event: "headers",
            data: {
              headers: toObject(res.headers),
              status: res.status,
              statusText: res.statusText,
            },
          });

          for await (const chunk of readBody(res)) {
            this.send({
              id,
              event: "body",
              data: Array.from(chunk),
            });
          }

          this.send({ id, event: "end" });
        })
        .catch((err) => console.error(err));
    });

    server.accept();

    return new Response(null, { status: 101, webSocket });
  }
}

async function* readBody(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) return;

  while (true) {
    const { done, value } = await reader?.read();
    if (done) return;
    yield value;
  }
}

export type IRequestParams = {
  input: RequestInfo | URL;
  init?: RequestInit<RequestInitCfProperties>;
};

export type IAbortSignal = "abort";

export type IEvent =
  | { id: string; event: "headers"; data: object }
  | { id: string; event: "body"; data: number[] }
  | { id: string; event: "end"; data: null };

export const createUnboundFetch = (params: {
  name?: string;
  binding: DurableObjectNamespace<UnboundFetch>;
  threshold?: number;
  shardLimit?: number;
}) => {
  let numSubrequests = 0;
  let sockets: Map<number, WebSocket> = new Map();

  const id = crypto.randomUUID();
  const name = params.name || "unboundFetch";
  const threshold = params.threshold || 0;
  const shardLimit = params.shardLimit || 100;
  const requests = new Map<string, Deferred<Response>>();
  const streams = new Map<string, ReadableStreamDefaultController>();

  const getFetch = async () => {
    const shard = (numSubrequests / shardLimit) | 0;

    if (!sockets.has(shard)) {
      const stubId = params.binding.idFromName(`${id}-${name}-${shard}`);
      const stub = params.binding.get(stubId);

      const socket = await new Promise<WebSocket>(async (resolve) => {
        const { webSocket } = await stub.fetch("http://internal/ws", {
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
          },
        });

        webSocket?.addEventListener("message", (evt) => {
          const { id, event, data } = JSON.parse(evt.data) as IEvent;

          switch (event) {
            case "headers": {
              requests.get(id)?.resolve?.(
                new Response(
                  new ReadableStream({
                    start: (ctl) => {
                      streams.set(id, ctl);
                    },
                  }),
                  data
                )
              );
              break;
            }
            case "body": {
              streams.get(id)?.enqueue(new Uint8Array(data));
              break;
            }
            case "end": {
              streams.get(id)?.close();
              requests.delete(id);
              streams.delete(id);
              break;
            }
          }
        });
        webSocket?.accept();
        if (webSocket) resolve(webSocket);
      });
      sockets.set(shard, socket);
    }

    return (
      input: RequestInfo | URL,
      init?: RequestInit<RequestInitCfProperties>
    ) => {
      const currentShard = shard;
      const id = crypto.randomUUID();
      const deferred = new Deferred<Response>();
      requests.set(id, deferred);
      init?.signal?.addEventListener("abort", (e) =>
        sockets.get(currentShard)?.send(JSON.stringify([id, "abort"]))
      );
      const params = {
        input,
        init: { ...init, headers: toObject(init?.headers) },
      };
      sockets.get(currentShard)?.send(JSON.stringify([id, params]));
      return deferred.promise;
    };
  };

  const unboundFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit<RequestInitCfProperties>
  ): Promise<Response> => {
    if (++numSubrequests < threshold) {
      return fetch(input, init);
    } else {
      return getFetch().then((fetch) => fetch(input, init));
    }
  };

  return unboundFetch;
};

export class Deferred<T = unknown> {
  promise: Promise<T>;
  resolve?: (arg: T) => void;
  reject?: (err: unknown) => void;
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export const toObject = (
  headers: HeadersInit | undefined
): Record<string, string> => {
  if (typeof headers === "undefined") {
    return {};
  } else if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  } else if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  } else if (typeof headers === "object" && headers !== null) {
    return headers;
  }

  throw new Error("could not extract headers");
};
