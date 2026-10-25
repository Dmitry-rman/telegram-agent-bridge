# Security, permissions and retention

## Threat boundaries

- The trusted hosting gateway must validate the owner identity and prevent caller spoofing of `oai-authenticated-user-id`. Do not deploy this unchanged on a public raw Worker endpoint. A supplied header is not a substitute for authentication.
- Only the paired numeric sender in their direct private chat is accepted. Groups, forwards and bot-mediated messages are rejected. Single-owner use is intentional.
- Private setup enforces origin, CSRF, body bounds and restrictive response headers. Bot credentials use AES-GCM with owner-bound associated data and purpose-separated keys. The master key lives separately in native secret storage.
- Ingress holds no bot token. It stores encrypted relay payloads; queue reads are possible only through the hosting provider’s authenticated native database connector, not any ingress endpoint. Replay tombstones contain update IDs but no message text.
- Telegram bot chats are **not end-to-end encrypted**. Telegram, hosting/storage providers and the assistant provider participate in the data path. This is not a promise that only the model can access the data.
- The private inbox/outbox and saved transcripts contain plaintext. Encryption of relay messages does not make the whole system end-to-end encrypted.

## Permissions

Incoming messages and transcribed speech must not override system/tool policy. Connecting transport is not blanket authority for purchases, external messages, destructive actions, secret changes, scheduling or deployment. Keep the assistant's normal confirmation requirements. Do not log tokens, token-bearing download URLs, audio base64, pairing challenges or raw message payloads.

## Retention

Private messages/replies older than approximately 24 hours are pruned on relevant authenticated operations; ingress pending ciphertext expires on the next accepted ingress. These are activity-driven cleanup rules, **not a wall-clock deletion service**. An idle deployment may retain old data until the next operation. Notification idempotency records have no automatic expiry: they retain a content-free digest, key, state and delivery ID rather than notification text. Cursor, replay tombstones, credential records and platform backups also follow different lifetimes. Telegram and assistant history are outside this cleanup.

The transcription caller must delete temporary user audio in `finally`, including timeouts and failures. Model downloads may remain cached; user audio must not. This CLI intentionally does not delete its caller-owned input automatically.

## Operations

Run tests before changes. Verify real gateway denial, pairing, webhook retries, idempotent private import and uncertain-send recovery after deploying. Preserve original encryption keys to read existing credentials; changing them blindly can make data unusable. For suspected compromise, use official BotFather/provider secret rotation and review active webhooks. Do not upload runtime state for troubleshooting.

`python3 scripts/check-shareable.py` is a heuristic source-package guard, not a comprehensive secret scanner or a security audit. Manually review the staged files before publishing. Report vulnerabilities privately to the eventual repository owner's chosen security channel; none is configured by this starter.
