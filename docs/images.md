# Sending an image reply

The private `send_photo_reply` tool uploads one existing PNG/JPEG to the paired Telegram owner using the official [sendPhoto API](https://core.telegram.org/bots/api#sendphoto). Image generation remains with the same assistant and its existing generator; the bridge does not call an image model or generate/transform files. Incoming Telegram photos and proactive image notifications are not implemented by this tool.

## Setup and host capability

For an existing private bridge, apply migration `0005_photo_reply.sql` before using image replies, deploy the updated private Worker, and refresh its MCP tool discovery if the host caches the tool list. The migration adds `outbox.kind`, with existing rows defaulting to `text`; it preserves all existing sending/sent/uncertain attempts. Fresh databases use the updated schema or the complete migration chain, not both. No ingress update, webhook registration or secret change is required for this feature.

The host must be able to obtain actual file bytes from its generator/artifact store and pass a structured argument object to the authenticated private MCP tool **programmatically**. An image preview, sandbox path or artifact reference alone is not sufficient. The Worker cannot read a host-local file, and it accepts neither remote image URLs nor local paths. Do not expose generated/private images publicly to work around this boundary. If the host cannot access bytes or its tool gateway rejects the argument size, this source change alone does not complete the integration; use a reviewed host adapter rather than inventing base64 or claiming delivery.

## Arguments and limits

| Argument | Meaning |
| --- | --- |
| `update_id` | Existing retained incoming owner message to answer |
| `photo_base64` | Standard padded base64 of the actual PNG/JPEG file; no whitespace or data-URL prefix |
| `mime_type` | `image/png` or `image/jpeg`, matching the file header |
| `caption` | Optional plain text, up to 1024 UTF-16 code units; no parse mode |

The bridge limits decoded bytes to **5,000,000** (base64 at most 6,666,668 characters). This is a bridge limit below Telegram's documented 10 MB photo limit. The host gateway may impose a smaller tool-request limit; verify on the target host. Base64 adds approximately one third to the file size. Pass file bytes through the host's native executor/tool client without copying the encoded payload into conversation text or logs.

The bridge validates PNG/JPEG headers and positive dimensions, requiring width plus height at most 10,000 and aspect ratio at most 20, matching the documented photo constraints. These are bounded header checks, not a full decoder: corrupt or otherwise unsupported images can still be rejected by Telegram. JPEG baseline/extended sequential/progressive frame headers are supported. SVG, WebP, GIF, videos, albums and original-file document uploads are outside this tool. Generate or explicitly convert to PNG/JPEG in the trusted host when needed; the bridge does not resize or convert.

For example, inside the host's private executor, construct the argument object from an actual generated file:

```python
import base64
from pathlib import Path

# These are values supplied by the existing host workflow, not literal sample IDs.
arguments = {
    "update_id": incoming_update_id,
    "mime_type": "image/png",
    "photo_base64": base64.b64encode(Path(generated_png_path).read_bytes()).decode("ascii"),
    "caption": "Generated image",
}
# Pass arguments directly to send_photo_reply through the existing authenticated
# private tool client. Do not print arguments or call an untrusted public endpoint.
```

This shows encoding only; it is not a bundled host adapter. The executor should enforce the size limit before reading a large file, clean up temporary image/argument files according to the host's private retention policy, and avoid logging the generated payload. The image generator's own artifact retention is separate.

## One reply and uncertain delivery

Choose **text** (`send_reply`) or **image with optional caption** (`send_photo_reply`) for the same incoming update. Both share the existing single outbox reservation. Sending a text reply first consumes that reservation; sending a photo afterward for the same update is rejected. Decide the response format before sending. Do not substitute a new update ID or a notification key to bypass this protection.

Before upload, the bridge durably reserves the outbox as `kind=photo`, state `sending`, with a domain-separated SHA-256 digest of the bytes, MIME and caption in its existing `text` column. It stores no image bytes/base64, filename, URL or plaintext caption in that row. Identical calls return the saved sending/sent/uncertain state and message ID without another network send. A changed image, MIME, caption or response type is rejected.

The upload is multipart HTTPS to Telegram's fixed API endpoint. Its content boundary is set by Fetch, and redirects are not followed. Only the verified owner chat and saved incoming message ID determine the destination/reply target. Successful confirmation records `sent`. Timeout, network error, unconfirmed response, rate limit or invalid returned message ID remains `uncertain` under the existing conservative send policy. Never automatically retry the upload or fall back to a text send after an ambiguous outcome; ask the owner to verify Telegram before manual recovery. Outbox reservations also stop typing and exclude the update from unattempted-message handoff results.

`TRANSPORT_DIAGNOSTICS=true` includes `sendPhoto` HTTP timing under the existing private [diagnostics contract](latency.md#optional-http-diagnostics). It does not log bytes, base64, digest, caption, filename or upstream error text. The host's own tool-history and provider logging policies remain outside this guarantee.

## Verification

Local tests cover tool discovery, authorization, actual Fetch multipart serialization/parsing with a synthetic PNG, destination binding, validation/size limits, JPEG header parsing, migration preservation, text/photo conflicts, in-flight duplicate blocking, timing redaction and failure states without automatic retry. They do not prove that a particular host can transfer generator files, that its gateway accepts large arguments, or that Telegram displays the photo.

After an authorized rollout, verify the host byte-transfer capability and one non-sensitive generated image reply to a new owner message. Privately record the returned state; do not repeat an uncertain live send or commit images/encoded arguments/traces. This repository does not deploy or send a live test image automatically.
