# Provider adapter contract

This is an integration boundary, not an implemented universal provider SDK.

## Included adapter

Workers export `default.fetch(request, env)` and use a D1-like `env.DB`. Only the private bridge exposes MCP through the Sites-specific `/mcp` JSON-RPC discovery/tool interface. Authorization relies on `oai-authenticated-user-id` inserted by a trusted platform gateway, compared exactly to configured owner IDs. Merely providing that header on an arbitrary public server is NOT authentication.

## Porting checklist

A new host/provider adapter must supply and verify:

- `identity(request) → authenticated principal`: validate the provider's signed session/token, strip client-supplied identity headers, and enforce one configured owner. Fail closed before calling protected tools.
- `database`: SQLite-compatible prepared statements, atomic `batch`, and persistence/locking semantics tested against the actual platform.
- `secrets`: native secret storage for master/relay/webhook secrets, without putting them in browser code, logs, source or tool output.
- `tools`: expose the existing tool schemas/results through the assistant provider's supported authenticated tool protocol. Translate discovery/initialization as needed; this implementation is not a generic MCP SDK server.
- `assistant context`: attach tools to the existing assistant/thread. Do not spawn a replacement agent and call it the same assistant.
- `queue reads`: use a native authenticated database connector for the write-only ingress. Public MCP/read/admin routes must not be added to ingress.
- `wake/schedule`: use only provider-supported, user-authorized execution. Queue delivery alone is insufficient.
- `voice execution`: optional isolated subprocess runner with ephemeral files and an outer time limit. The bridge does not execute local Python automatically.

Require negative authorization tests, replay/uncertain-send tests, a fresh deployment round trip and timeout/recovery checks before treating a port as supported. No provider other than the included host-specific adapter is certified by this export.
