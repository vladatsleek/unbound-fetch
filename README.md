# Unbound Fetch

Uses `DurableObjects` to get up to 500k subrequests.

### Installation

```
npm i unbound-fetch --save
```

### Usage

`wrangler.toml`

```toml
durable_objects.bindings = [
  { name = "UnboundFetch", class_name = "UnboundFetch" }
]

migrations = [
  { tag = "v1", new_classes = [ "UnboundFetch" ] }
]
```

`index.ts`

```ts
import { createUnboundFetch, UnfoundFetch } from "unbound-fetch";

interface IEnv {
  UnboundFetch: DurableObjectNamespace<UnboundFetch>;
}

export default {
  fetch(req: Request, env: IEnv, ctx: ExecutionContext) {
    const fetch = createUnboundFetch({
      binding: env.UnboundFetch,
    });

    return fetch(
      "https://api.github.com/search/repositories?sort=stars&order=desc&q=language:javascript"
    );
  },
};

export const { UnboundFetch };
```

### Example

For end to end `10k` requests example please check `/example` folder.

### License

MIT
