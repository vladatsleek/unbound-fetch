import { streamSSE } from "./helpers";
import { createUnboundFetch, UnboundFetch } from "../src/unbound-fetch";

export type IEnv = {
  UnboundFetch: DurableObjectNamespace<UnboundFetch>;
};

export default {
  async fetch(req: Request, env: IEnv, ctx: ExecutionContext) {
    const fetch = createUnboundFetch({
      binding: env.UnboundFetch,
    });

    return streamSSE(ctx, async (emit) => {
      for (let i = 0; i < 10000; i++) {
        const res = await fetch(
          "https://api.github.com/search/repositories?sort=stars&order=desc&q=language:javascript"
        );
        if (res.ok) emit(`req${i}`, await res.json());
        else console.error(res.statusText || res.status);
      }
    });
  },
};

export * from "../src/unbound-fetch";
