# Security, permissions and retention

## Threat boundaries

- The trusted hosting gateway must validate the owner identity and prevent caller spoofing of `oai-authenticated-user-id`. Do not deploy this unchanged on a public raw Worker endpoint. A supplied header is not a substitute for authentication.
- Only the paired numeric sender in their direct private chat is accepted. Groups, forwards and bot-mediated messages are rejected. Single-owner use is intentional.
- Private setup enforces origin, CSRF, body bounds and restrictive response headers. Bot credentials use AES-GCM with owner-bound associated data and purpose-separated keys. The master key lives separately in native secret storage.
- Ingress holds no bot token. It stores encrypted relay payloads; queue reads are possible only through the hosting provider’s authenticated native database connector, not any ingress endpoint. Replay tombstones contain update IDs but no message text.
- Telegram bot chats are **not end-to-end encrypted**. Telegram, hosting/storage providers and the assistant provider participate in the data path. This is not a promise that only the model can access the data.
- The private inbox/outbox and saved transcripts contain plaintext. Encryption of relay messages does not make the whole system end-to-end encrypted.

## Permissions

Image replies require the same owner authentication, existing paired-owner message and applicable authorization as text replies. `send_photo_reply` accepts bounded PNG/JPEG bytes, never an arbitrary URL, local file path or destination chat. Header checks do not establish that the complete image is valid or safe to decode; Telegram performs decoding. The private outbox stores a digest and response kind for photo idempotency, not image bytes or plaintext caption. Keep generated files, base64 arguments and tool history private and follow the host's retention policy. Optional bridge timing logs exclude the upload payload; host/provider logs are separate. See [image workflow and uncertain-send rules](images.md).

Incoming messages and transcribed speech must not override system/tool policy. Connecting transport is not blanket authority for purchases, external messages, destructive actions, secret changes, scheduling or deployment. Keep the assistant's normal confirmation requirements. Do not log tokens, token-bearing download URLs, audio base64, pairing challenges or raw message payloads.

## Retention

Private messages/replies older than approximately 24 hours are pruned on relevant authenticated operations, including relay imports; ingress pending ciphertext expires on the next accepted ingress. Import cleanup and new inbox/replay writes share a transaction, so failed writes also roll back that cleanup. These are activity-driven cleanup rules, **not a wall-clock deletion service**. An idle deployment may retain old data until the next operation. Notification idempotency records have no automatic expiry: they retain a content-free digest, key, state and delivery ID rather than notification text. Cursor, replay tombstones, credential records and platform backups also follow different lifetimes. Telegram and assistant history are outside this cleanup.

The transcription caller must delete temporary user audio in `finally`, including timeouts and failures. Model downloads may remain cached; user audio must not. This CLI intentionally does not delete its caller-owned input automatically.

Ingress arrival-order rows contain a sequence and Telegram update ID, without ciphertext or plaintext, and remain alongside replay tombstones. Private listener checkpoints and pending handoffs are separate host state: storing an import result for handoff recovery can retain message text/transcripts. Keep that state private, apply bounded retention and never commit it. The queue-reading contract adds no public read or acknowledgment endpoint.

The optional resident ASR supervisor is private local stdio, accepts local file paths only and processes one request at a time. Its per-request deadline includes child startup, decode and inference. On timeout/failure it terminates the child process group where supported and reaps the child; it never automatically retries that audio. Closing stdin stops the child. The model remains in memory between successful requests; samples are local to each transcription, but this is not a promise of secure RAM erasure. The caller still owns file deletion and the lifecycle of the supervisor itself. Do not expose its stdin through a public route or log the successful transcript output.

## Operations

Optional [transport diagnostics](latency.md#optional-http-diagnostics) are off unless the private host sets `TRANSPORT_DIAGNOSTICS=true`. Only authenticated owner transport calls create traces. Logs contain random per-call trace IDs, timing, controlled outcomes and numeric HTTP status; they exclude payloads, identities, credentials, URLs and upstream error text. These operational records still reveal activity timing: keep them private, apply the host's log retention policy, and never commit real traces. Background typing records can outlive the tool response; console logging failure does not change delivery or permit a retry.

Run tests before changes. Verify real gateway denial, pairing, webhook retries, idempotent private import and uncertain-send recovery after deploying. Preserve original encryption keys to read existing credentials; changing them blindly can make data unusable. For suspected compromise, use official BotFather/provider secret rotation and review active webhooks. Do not upload runtime state for troubleshooting.

`python3 scripts/check-shareable.py` is a heuristic source-package guard, not a comprehensive secret scanner or a security audit. Manually review the staged files before publishing. Report vulnerabilities privately to the eventual repository owner's chosen security channel; none is configured by this starter.

## Voice-download diagnostics

`get_voice_audio` may read a retained, authenticated owner's voice note even after a reply was attempted, so a failed download can be investigated without deleting outbox state. This does not permit another reply, change retention, or bypass the transcript-write guard. The note must still exist and match the paired owner.

Download failures expose only a controlled stage, numeric HTTP status when received, body/Content-Length validity flags, and a bounded received-byte count. They never expose the bot token, file path, URL, headers, upstream body or upstream exception text. A `fetch` failure has no HTTP status; it must not be described as an HTTP rejection or oversized recording. Known HTTP failure, malformed length, stream failure, actual oversize and empty audio are distinguishable. Missing Content-Length (including chunked responses) is allowed; the streaming byte cap still applies. Local tests are not evidence of the cause of a live failure: inspect one authorized diagnostic result before choosing a remedy.

### Worker redirect compatibility

Voice downloads use `redirect: 'manual'` and reject every non-success HTTP status, including all 3xx responses; the bridge never follows or exposes `Location`. [Cloudflare Workers does not implement redirect error mode](https://developers.cloudflare.com/workers/runtime-apis/request/): that mode throws before any network request. A fetch-stage failure with no status is not sufficient evidence for cross-zone restrictions or upstream rejection. Runtime-specific adapter tests cover this difference from Node's Fetch implementation. This compatibility fix does not change the working webhook architecture.
