# HyperHDR Homey Integration — Design

**Date:** 2026-05-10
**Status:** Approved (brainstorming)
**Target SDK:** Homey Apps SDK v3 (JavaScript)

## Goal

Local control of HyperHDR LED installations from Homey: on/off, dimming, hue/saturation, and effects.

## Non-goals (v1)

- Ambilight / grabber control (HDMI grabber, V4L, system grabber components).
- Calibration UI (gamma, color matrix, temperature, LUT).
- Multi-server hub features — each HyperHDR server pairs separately.
- Effect creation/editing.

## Inputs and prior art

- **HyperHDR JSON-RPC API** — schemas in `references/HyperHDR/sources/api/JSONRPC_schema/`. Default WebSocket on port 8090. Commands used: `color`, `effect`, `clear`, `componentstate`, `serverinfo`, `instance`, `authorize`.
- **Home Assistant `hyperion` integration** — `references/hyperion/`. Per-instance light entity, dynamic effect list, SSDP discovery, optional token auth.
- **Old `hyperion-homey` app** — `references/hyperion-homey/`. SDK v1, single device, hardcoded effect enum, no auth, deprecated `hyperion-client` dependency. Reference only — does not constrain v2 design.

## Architecture

```
hyperhdr-homey/
├── app.json                      # SDK v3 manifest, custom capability, flow cards
├── app.js                        # Homey.App stub
├── drivers/
│   └── hyperhdr/
│       ├── driver.compose.json   # capabilities, discovery strategies, pair templates
│       ├── driver.js             # discovery + pair list_devices
│       ├── device.js             # capability listeners, lifecycle, reconnect
│       └── pair/
│           ├── auth.html         # token entry view (when server requires it)
│           └── manual.html       # host:port fallback view
└── lib/
    └── HyperHdrClient.js         # WebSocket JSON-RPC client (one per device)
```

Three layers with clear seams:

1. **`HyperHdrClient`** — pure transport. WebSocket to `ws://host:port/`, JSON-RPC request/response with `tan` correlation, optional bearer token via `authorize`, auto-reconnect with backoff. Emits `update`, `closed`, `error`. No Homey types leak in.
2. **`HyperHdrDevice`** — Homey `Device` subclass. Owns one client, binds capability listeners, mirrors HyperHDR state from `serverinfo` push updates, fires trigger flow cards. Brightness/effect logic lives here.
3. **`HyperHdrDriver`** — Homey `Driver` subclass. Implements `onPairListDevices` (discovery → list of `{ name, data: { serverId, instance }, settings }`) and registers driver-level autocomplete listeners that delegate to the addressed device for the current effect list.

### Why one WS per device

HyperHDR setups rarely have more than 2–3 instances per server. Per-device sockets give isolated failure handling, simpler instance switching (`instance` command sent once per connection), and trivial cleanup on `onDeleted`. A shared-server connection pool can replace this later without changing the public driver/device contract if a real user reports overhead.

## Pairing flow

1. **Discovery view** (default): `driver.compose.json` declares mDNS strategy (`_hyperhdr-json._tcp`) and SSDP strategy (`urn:hyperion-project.org:device:basic:1`). Homey aggregates results and presents the list.
2. **Manual fallback view**: host + port input if discovery returns nothing or the user picks "Add manually".
3. **Auth probe**: connect; send `serverinfo`. If the server replies with an auth-required error, route to the **token entry** view; submit via `authorize { token }`; on success stash the token in device store (not settings).
4. **Instance enumeration**: read `serverinfo.instance[]`. Produce one Homey device per instance with:
   - `data: { serverId: serverinfo.cid, instance: <index> }`
   - `name: "<server hostname> — <instance friendly_name>"`
   - `settings: { host, port, priority: 128, origin: "Homey" }`
   - `store: { token? }`

`serverId` is stable across IP changes; on reconnect we re-resolve `host:port` from current discovery results before falling back to the stored value.

## Capabilities

Listed in `driver.compose.capabilities` in this order (drives the device tile layout):

| Capability | Type | Behaviour |
|---|---|---|
| `onoff` | bool | `true` → `componentstate { component: "LEDDEVICE", state: true }` then reapply last color or effect. `false` → `componentstate { LEDDEVICE, false }` then `clear` at our priority. |
| `dim` | number 0–1 | Solid mode: scale RGB by `dim` before sending `color`. Effect mode: stored only — does not modify the running effect (matches Home Assistant). Re-applied on next solid transition. |
| `light_hue` | number 0–1 | On change: switch to solid mode, recompute RGB from current hue/saturation/dim, send `color` at configured priority. |
| `light_saturation` | number 0–1 | Same as `light_hue`. |
| `light_mode` | enum `color`/`temperature` | Always `color` — included so Homey renders the standard light tile. CCT not modelled (HyperHDR has no native temperature control we want to expose in v1). |
| `hyperhdr_effect` | custom enum | Populated dynamically from `serverinfo.effects[]` plus a synthetic `__none__` value. Setting an effect → `effect` command at priority. Setting `__none__` → `clear` at our priority and restore the last solid color if `dim > 0`, otherwise leave dark. |

The custom capability is defined in `app.json#capabilities.hyperhdr_effect` with a placeholder values list (e.g. `[{ id: "__none__", title: "No effect" }]`); the per-device list is set via `setCapabilityOptions` after the first `serverinfo` arrives, and refreshed when `serverinfo.update` reports an effects change.

### Brightness math

```
const r = Math.round(baseR * dim);
const g = Math.round(baseG * dim);
const b = Math.round(baseB * dim);
client.color({ priority, color: [r, g, b], origin });
```

`baseR/G/B` is the unscaled RGB derived from `light_hue` and `light_saturation` at full brightness. `dim = 0` is treated as "off-ish" — we still issue the command (color `[0,0,0]`) so the priority slot remains held; the user can use `onoff` for a hard off.

## Flow cards

| Type | ID | Arguments | Behaviour |
|---|---|---|---|
| Action | `start_effect` | `effect` (autocomplete), `duration` (ms, optional) | Sends `effect` at configured priority. |
| Action | `set_color` | `color` (Homey color token, hex), `duration` (ms, 0 = indefinite) | Sends `color` at configured priority. Updates `light_hue`/`light_saturation` capability state to match. |
| Action | `clear_effect` | — | Sends `clear` at our priority. Device restores last solid color if `dim > 0`. |
| Trigger | `effect_started` | Token: `effect` (string) | Fires when `serverinfo.update` shows our instance picked up an effect from any source whose `tan` is not ours. |
| Trigger | `effect_stopped` | Token: `effect` (string, last running) | Fires when our instance transitions out of an effect priority. |
| Trigger | `component_changed` | Tokens: `component` (string), `state` (bool) | Fires for LEDDEVICE / SMOOTHING / HDR flips on our instance. Other components ignored (out of scope). |

The driver registers an autocomplete listener for `start_effect.effect` that calls `device.getEffectList()` (which simply reads cached `serverinfo`) and filters by the user's query.

## Connection lifecycle

- **`onInit`** — build `HyperHdrClient`, connect, send `instance` to switch to our index, send `serverinfo` with `subscribe: ["components-update", "priorities-update", "effects-update"]`. Cache initial state. Set capability availability.
- **Push updates** — on each `serverinfo.update`, diff against the cached snapshot for our instance:
  - Component change → fire `component_changed` if relevant component, update internal state.
  - Visible priority change → fire `effect_started`/`effect_stopped` based on whether the new top priority is an effect, and whether its `tan` matches one we sent (skip if ours).
  - Effects list change → refresh `hyperhdr_effect` capability options.
- **Reconnect** — exponential backoff: 1 s, 2 s, 4 s, …, capped at 30 s with full jitter. While disconnected, `setUnavailable("Cannot reach HyperHDR")`; capability writes reject with a translated error.
- **`onDeleted`** — close socket, clear timers, no `clearall` (we leave existing priorities alone).

## Settings (per device, editable post-pair)

- `priority` (int 1–253, default **128**) — priority slot for `color` / `effect` commands. Matches Home Assistant default.
- `origin` (string, default `"Homey"`) — shown in HyperHDR's "active sources" UI; useful for users to see who's driving the strip.

Auth token lives in device store, never in settings UI.

## Dependencies

- **`ws`** — WebSocket client.
- **No other runtime dependencies.** Discovery is pure-Homey via SDK strategies.

The old app's `hyperion-client` dep is intentionally not used: it is unmaintained, predates HyperHDR's auth flow, and wraps ~30 lines of JSON-RPC the device layer can own directly.

## Testing

- **Unit — `HyperHdrClient`** against an in-process `ws.Server`: connect, auth happy/sad, command/response correlation via `tan`, push update parsing, reconnect, close.
- **Unit — `HyperHdrDevice`** with a mock client: brightness math (solid + post-effect), on/off semantics, effect ↔ solid transitions, trigger filtering by `tan`, capability option refresh on effects-update.
- **Integration smoke** (`HYPERHDR_HOST=…` env, skipped in CI): drive a real server — set red, run an effect, clear, assert via `serverinfo`.
- **Manual** — `homey app run --remote` against a Homey Pro: full pairing on a server with auth required, on a server without, manual-fallback path, instance multiplexing.

## Open follow-ups (deferred, not v1)

- Shared-server WS pool (refactor target if real-world setups have many instances).
- HDMI/V4L grabber controls — would require a separate device class or sub-capabilities; out of v1 because non-goal.
- Token rotation / re-auth UI when a stored token is revoked.
- LED layout sensor surface for users who want to flow-trigger on visible-priority change beyond the included triggers.
