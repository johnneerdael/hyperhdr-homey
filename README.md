# HyperHDR Homey

Homey Apps SDK v3 integration for [HyperHDR](https://github.com/awawa-dev/HyperHDR).
Local control of LED installations: on/off, dimming, hue/saturation, and effects.

## Features

- One Homey device per HyperHDR instance.
- mDNS discovery, manual host entry as fallback.
- Optional bearer token authentication.
- Standard Homey light tile (on/off, dim, hue, saturation) plus an Effect picker that follows the server's effect list.
- Flow actions: Start effect (autocomplete), Set color, Clear effect.
- Flow triggers: An effect started, An effect stopped, A component changed state.

## Non-goals (v1)

Ambilight / grabber control, calibration UI, multi-server hub aggregation, effect editing.

## Configuration

Each device exposes:

- **Host / Port** — HyperHDR JSON-RPC endpoint (default port 8090).
- **Priority** — 1–253. Default 128, matching Home Assistant. Lower number = higher precedence.
- **Origin label** — appears in HyperHDR's active-source list.

The bearer token (if any) is captured during pairing and stored privately.

## Developing

```bash
npm install
npm test
npx homey app run
```

## Smoke testing against a real server

```bash
HYPERHDR_HOST=hyperhdr.local HYPERHDR_TOKEN=… node --test tests/integration.smoke.test.js
```

## License

MIT — see `LICENSE`.
