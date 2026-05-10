# HyperHDR Homey Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Homey Apps SDK v3 integration that controls HyperHDR LED installations locally — on/off, dimming, hue/saturation, and effects — via HyperHDR's JSON-RPC WebSocket API, with one Homey device per HyperHDR instance.

**Architecture:** Three layers. A pure-transport `HyperHdrClient` (WebSocket JSON-RPC, one per device, optional token auth, auto-reconnect). A Homey `Device` subclass that owns one client, mirrors `serverinfo` push state, binds capability listeners, and fires triggers. A Homey `Driver` subclass that handles pairing (mDNS/SSDP discovery + manual fallback + token entry) and flow-action autocomplete. Brightness math is a pure-function helper. All tests use `node --test` against an in-process `ws.Server` mock.

**Tech Stack:** Node.js 18+ (CommonJS), Homey Apps SDK v3 (`homey` package), `ws` for WebSocket client and test server, `node:test` + `node:assert/strict` for tests, no other runtime deps.

**Conventions for every task:**
- Run `node --test tests/` before each commit; expect green.
- Commits are scoped: one feature → one commit. Use Conventional Commits.
- Replace `<root>` in commands with the absolute path to `hyperhdr-homey/`. All paths in this plan are relative to that root unless noted.
- Spec: `docs/specs/2026-05-10-hyperhdr-homey-design.md`. Open it alongside this plan.

---

## Task 1: Project scaffold + first commit

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `app.js`
- Create: `app.json`
- Create: `README.md`
- Create: `locales/en.json`
- Create: `assets/icon.svg`
- Create: `tests/.gitkeep`

- [ ] **Step 1: `git init` and create scaffold files**

Run:
```bash
cd <root>
git init -b main
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
.env
.DS_Store
*.log
.homeybuild/
```

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "com.hyperhdr.homey",
  "version": "1.0.0",
  "description": "Local control of HyperHDR LED installations from Homey.",
  "main": "app.js",
  "scripts": {
    "test": "node --test tests/",
    "validate": "homey app validate -l debug"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "homey": "^3.0.0",
    "ws": "^8.16.0"
  },
  "license": "MIT"
}
```

- [ ] **Step 4: Write `app.js`**

```javascript
'use strict';

const Homey = require('homey');

class HyperHdrApp extends Homey.App {
  async onInit() {
    this.log('HyperHDR app started.');
  }
}

module.exports = HyperHdrApp;
```

- [ ] **Step 5: Write minimal `app.json`** (filled in later tasks)

```json
{
  "id": "com.hyperhdr.homey",
  "version": "1.0.0",
  "compatibility": ">=5.0.0",
  "sdk": 3,
  "name": { "en": "HyperHDR" },
  "description": { "en": "Local control of HyperHDR LED installations." },
  "category": ["lights"],
  "permissions": [],
  "images": {
    "small": "/assets/icon.svg",
    "large": "/assets/icon.svg"
  },
  "author": { "name": "HyperHDR Homey contributors" },
  "drivers": [],
  "capabilities": {},
  "flow": { "triggers": [], "conditions": [], "actions": [] }
}
```

- [ ] **Step 6: Write placeholder icon `assets/icon.svg`**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#0d1117"/><circle cx="50" cy="50" r="28" fill="#ff7a00"/></svg>
```

- [ ] **Step 7: Write `locales/en.json`**

```json
{
  "app": {
    "name": "HyperHDR"
  }
}
```

- [ ] **Step 8: Write `README.md`**

```markdown
# HyperHDR Homey

Homey Apps SDK v3 integration for [HyperHDR](https://github.com/awawa-dev/HyperHDR).
Local control of LED installations: on/off, dimming, color, and effects.

See `docs/specs/` and `docs/plans/`.
```

- [ ] **Step 9: Install deps and run validate as smoke test**

Run:
```bash
cd <root>
npm install
npx homey app validate -l debug
```
Expected: validate passes (some warnings about missing drivers acceptable at this stage; if it fails, the manifest shape is wrong).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: initial Homey app scaffold"
```

---

## Task 2: `HyperHdrClient` — connect, close, basic command

**Files:**
- Create: `lib/HyperHdrClient.js`
- Create: `tests/HyperHdrClient.test.js`
- Create: `tests/helpers/mockHyperHdrServer.js`

- [ ] **Step 1: Write the failing test**

`tests/HyperHdrClient.test.js`:
```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startMockServer } = require('./helpers/mockHyperHdrServer');
const HyperHdrClient = require('../lib/HyperHdrClient');

test('connects, sends serverinfo, receives reply, closes cleanly', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({
          command: 'serverinfo',
          success: true,
          tan: msg.tan,
          info: { instance: [{ instance: 0, friendly_name: 'HyperHDR', running: true }] }
        }));
      }
    }
  });

  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port });
  await client.connect();
  const reply = await client.request({ command: 'serverinfo' });
  assert.equal(reply.success, true);
  assert.deepEqual(reply.info.instance[0].friendly_name, 'HyperHDR');
  await client.close();
  await mock.stop();
});
```

- [ ] **Step 2: Write the mock server helper**

`tests/helpers/mockHyperHdrServer.js`:
```javascript
'use strict';

const { WebSocketServer } = require('ws');

async function startMockServer({ onMessage } = {}) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => wss.on('listening', resolve));
  const port = wss.address().port;

  wss.on('connection', ws => {
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (onMessage) onMessage(msg, ws);
    });
  });

  return {
    port,
    wss,
    async stop() {
      await new Promise(resolve => wss.close(resolve));
    },
    broadcast(payload) {
      const data = JSON.stringify(payload);
      for (const ws of wss.clients) ws.send(data);
    }
  };
}

module.exports = { startMockServer };
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `node --test tests/HyperHdrClient.test.js`
Expected: FAIL — `Cannot find module '../lib/HyperHdrClient'`.

- [ ] **Step 4: Write minimal `HyperHdrClient`**

`lib/HyperHdrClient.js`:
```javascript
'use strict';

const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

class HyperHdrClient extends EventEmitter {
  constructor({ host, port = 8090, path = '/' } = {}) {
    super();
    if (!host) throw new Error('host is required');
    this.host = host;
    this.port = port;
    this.path = path;
    this._ws = null;
    this._tan = 0;
    this._pending = new Map();
  }

  get url() {
    return `ws://${this.host}:${this.port}${this.path}`;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const onOpen = () => {
        ws.off('error', onError);
        this._ws = ws;
        ws.on('message', raw => this._onMessage(raw));
        ws.on('close', () => { this._ws = null; this.emit('closed'); });
        ws.on('error', err => this.emit('error', err));
        resolve();
      };
      const onError = err => {
        ws.off('open', onOpen);
        reject(err);
      };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });
  }

  request(payload) {
    if (!this._ws) return Promise.reject(new Error('not connected'));
    const tan = ++this._tan;
    const message = { ...payload, tan };
    return new Promise((resolve, reject) => {
      this._pending.set(tan, { resolve, reject });
      this._ws.send(JSON.stringify(message), err => {
        if (err) {
          this._pending.delete(tan);
          reject(err);
        }
      });
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (typeof msg.tan === 'number' && this._pending.has(msg.tan)) {
      const { resolve } = this._pending.get(msg.tan);
      this._pending.delete(msg.tan);
      resolve(msg);
      return;
    }
    this.emit('update', msg);
  }

  close() {
    return new Promise(resolve => {
      if (!this._ws) return resolve();
      const ws = this._ws;
      ws.once('close', () => resolve());
      ws.close();
    });
  }
}

module.exports = HyperHdrClient;
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `node --test tests/HyperHdrClient.test.js`
Expected: PASS — 1 test, 1 ok.

- [ ] **Step 6: Commit**

```bash
git add lib tests
git commit -m "feat(client): WebSocket connect + JSON-RPC request/response with tan correlation"
```

---

## Task 3: `HyperHdrClient` — concurrent in-flight requests

**Files:**
- Modify: `tests/HyperHdrClient.test.js` (append)

- [ ] **Step 1: Write the failing test (append to file)**

```javascript
test('correlates concurrent requests by tan', async () => {
  const replies = new Map([
    ['serverinfo', { command: 'serverinfo', success: true, info: {} }],
    ['sysinfo', { command: 'sysinfo', success: true, info: { hostname: 'h' } }]
  ]);
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      const base = replies.get(msg.command);
      if (!base) return;
      // Reply out of order
      const delay = msg.command === 'serverinfo' ? 30 : 5;
      setTimeout(() => ws.send(JSON.stringify({ ...base, tan: msg.tan })), delay);
    }
  });

  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port });
  await client.connect();
  const [a, b] = await Promise.all([
    client.request({ command: 'serverinfo' }),
    client.request({ command: 'sysinfo' })
  ]);
  assert.equal(a.command, 'serverinfo');
  assert.equal(b.command, 'sysinfo');
  await client.close();
  await mock.stop();
});
```

- [ ] **Step 2: Run the test, verify it passes (Task 2 implementation already supports this)**

Run: `node --test tests/HyperHdrClient.test.js`
Expected: PASS — 2 tests, 2 ok.

If it fails, the bug is in `_onMessage` correlation; ensure the `tan` lookup is what resolves promises (not arrival order).

- [ ] **Step 3: Commit**

```bash
git add tests
git commit -m "test(client): concurrent request correlation"
```

---

## Task 4: `HyperHdrClient` — auth flow

**Files:**
- Modify: `lib/HyperHdrClient.js`
- Modify: `tests/HyperHdrClient.test.js` (append)

- [ ] **Step 1: Write the failing tests (append)**

```javascript
test('authorize sends token and resolves on success', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize' && msg.subcommand === 'login' && msg.token === 'good') {
        ws.send(JSON.stringify({ command: 'authorize-login', success: true, tan: msg.tan }));
      } else if (msg.command === 'authorize') {
        ws.send(JSON.stringify({
          command: 'authorize-login', success: false, tan: msg.tan, error: 'No Authorization'
        }));
      }
    }
  });

  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port, token: 'good' });
  await client.connect();
  await client.authorize();
  await client.close();
  await mock.stop();
});

test('authorize rejects on bad token', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize') {
        ws.send(JSON.stringify({
          command: 'authorize-login', success: false, tan: msg.tan, error: 'No Authorization'
        }));
      }
    }
  });

  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port, token: 'bad' });
  await client.connect();
  await assert.rejects(() => client.authorize(), /No Authorization/);
  await client.close();
  await mock.stop();
});

test('tokenRequired probe returns true when server requires auth', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({
          command: 'authorize-tokenRequired',
          success: true,
          tan: msg.tan,
          info: { required: true }
        }));
      }
    }
  });
  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port });
  await client.connect();
  assert.equal(await client.tokenRequired(), true);
  await client.close();
  await mock.stop();
});
```

- [ ] **Step 2: Run, verify two of the three FAIL**

Run: `node --test tests/HyperHdrClient.test.js`
Expected: 3 new tests fail with `client.authorize is not a function` / `client.tokenRequired is not a function`.

- [ ] **Step 3: Add `token` constructor option, `authorize`, `tokenRequired` methods**

In `lib/HyperHdrClient.js`, modify the constructor to accept `token`:

```javascript
  constructor({ host, port = 8090, path = '/', token = null } = {}) {
    super();
    if (!host) throw new Error('host is required');
    this.host = host;
    this.port = port;
    this.path = path;
    this.token = token;
    this._ws = null;
    this._tan = 0;
    this._pending = new Map();
  }
```

Append methods to the class (above `close`):

```javascript
  async tokenRequired() {
    const reply = await this.request({ command: 'authorize', subcommand: 'tokenRequired' });
    return Boolean(reply && reply.info && reply.info.required);
  }

  async authorize() {
    if (!this.token) throw new Error('no token configured');
    const reply = await this.request({
      command: 'authorize',
      subcommand: 'login',
      token: this.token
    });
    if (!reply.success) {
      const err = new Error(reply.error || 'authorization failed');
      err.code = 'EAUTH';
      throw err;
    }
    return reply;
  }
```

- [ ] **Step 4: Run, verify all tests pass**

Run: `node --test tests/HyperHdrClient.test.js`
Expected: 5 tests, 5 ok.

- [ ] **Step 5: Commit**

```bash
git add lib tests
git commit -m "feat(client): authorize and tokenRequired probe"
```

---

## Task 5: `HyperHdrClient` — subscribe + push update events

**Files:**
- Modify: `lib/HyperHdrClient.js`
- Modify: `tests/HyperHdrClient.test.js` (append)

- [ ] **Step 1: Write the failing test (append)**

```javascript
test('emits update events for unsolicited push messages', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({
          command: 'serverinfo', success: true, tan: msg.tan, info: { instance: [] }
        }));
        // Simulate an unsolicited push shortly after
        setTimeout(() => ws.send(JSON.stringify({
          command: 'components-update',
          data: { name: 'LEDDEVICE', enabled: false }
        })), 10);
      }
    }
  });

  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port });
  await client.connect();
  const updatePromise = new Promise(resolve => client.once('update', resolve));
  await client.request({ command: 'serverinfo' });
  const update = await updatePromise;
  assert.equal(update.command, 'components-update');
  assert.equal(update.data.name, 'LEDDEVICE');
  assert.equal(update.data.enabled, false);
  await client.close();
  await mock.stop();
});

test('subscribe sends serverinfo with subscribe array', async () => {
  let received = null;
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'serverinfo') {
        received = msg;
        ws.send(JSON.stringify({
          command: 'serverinfo', success: true, tan: msg.tan, info: {}
        }));
      }
    }
  });
  const client = new HyperHdrClient({ host: '127.0.0.1', port: mock.port });
  await client.connect();
  await client.subscribe(['components-update', 'priorities-update']);
  assert.deepEqual(received.subscribe, ['components-update', 'priorities-update']);
  await client.close();
  await mock.stop();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/HyperHdrClient.test.js`
Expected: `subscribe` test fails (`client.subscribe is not a function`); `update` test passes (Task 2 already emits).

- [ ] **Step 3: Add `subscribe` method**

Append to the class above `close`:

```javascript
  subscribe(events) {
    return this.request({ command: 'serverinfo', subscribe: events });
  }
```

- [ ] **Step 4: Run, verify all pass**

Run: `node --test tests/HyperHdrClient.test.js`
Expected: 7 tests, 7 ok.

- [ ] **Step 5: Commit**

```bash
git add lib tests
git commit -m "feat(client): subscribe to serverinfo push channels"
```

---

## Task 6: `HyperHdrClient` — auto-reconnect with backoff

**Files:**
- Modify: `lib/HyperHdrClient.js`
- Modify: `tests/HyperHdrClient.test.js` (append)

- [ ] **Step 1: Write the failing test (append)**

```javascript
test('reconnects after socket drops, fires connected event', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({ command: 'serverinfo', success: true, tan: msg.tan, info: {} }));
      }
    }
  });

  const client = new HyperHdrClient({
    host: '127.0.0.1',
    port: mock.port,
    reconnect: { initialDelayMs: 20, maxDelayMs: 100, jitter: false }
  });
  await client.start();
  await client.request({ command: 'serverinfo' });

  // Force the server to drop the connection
  for (const ws of mock.wss.clients) ws.terminate();

  await new Promise(resolve => client.once('connected', resolve));
  // Verify it works again
  const reply = await client.request({ command: 'serverinfo' });
  assert.equal(reply.success, true);

  await client.stop();
  await mock.stop();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/HyperHdrClient.test.js`
Expected: `client.start is not a function`.

- [ ] **Step 3: Replace `connect`/`close` with managed `start`/`stop` + reconnect loop**

Modify `lib/HyperHdrClient.js` constructor to accept reconnect options:

```javascript
  constructor({ host, port = 8090, path = '/', token = null, reconnect = {} } = {}) {
    super();
    if (!host) throw new Error('host is required');
    this.host = host;
    this.port = port;
    this.path = path;
    this.token = token;
    this.reconnectOpts = {
      initialDelayMs: reconnect.initialDelayMs ?? 1000,
      maxDelayMs: reconnect.maxDelayMs ?? 30000,
      jitter: reconnect.jitter ?? true
    };
    this._ws = null;
    this._tan = 0;
    this._pending = new Map();
    this._stopped = true;
    this._reconnectTimer = null;
    this._attempt = 0;
  }
```

Add `start`/`stop`/`_loop` methods. Keep `connect`/`close` as low-level helpers but rename internal versions:

```javascript
  async start() {
    this._stopped = false;
    this._attempt = 0;
    await this._connectOnce();
  }

  async stop() {
    this._stopped = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    await this.close();
  }

  async _connectOnce() {
    try {
      await this.connect();
      this._attempt = 0;
      this.emit('connected');
    } catch (err) {
      this.emit('error', err);
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._stopped) return;
    const { initialDelayMs, maxDelayMs, jitter } = this.reconnectOpts;
    const base = Math.min(initialDelayMs * 2 ** this._attempt, maxDelayMs);
    const delay = jitter ? Math.random() * base : base;
    this._attempt += 1;
    this._reconnectTimer = setTimeout(() => this._connectOnce(), delay);
  }
```

Modify the `connect` method's `close` handler to schedule reconnect when not stopped intentionally:

```javascript
        ws.on('close', () => {
          this._ws = null;
          this.emit('closed');
          this._rejectPending(new Error('connection closed'));
          if (!this._stopped) this._scheduleReconnect();
        });
```

Add `_rejectPending`:

```javascript
  _rejectPending(err) {
    for (const { reject } of this._pending.values()) reject(err);
    this._pending.clear();
  }
```

- [ ] **Step 4: Run, verify all pass**

Run: `node --test tests/HyperHdrClient.test.js`
Expected: 8 tests, 8 ok.

- [ ] **Step 5: Commit**

```bash
git add lib tests
git commit -m "feat(client): managed start/stop with exponential-backoff reconnect"
```

---

## Task 7: App manifest — capability + flow card declarations

**Files:**
- Modify: `app.json`
- Modify: `locales/en.json`

- [ ] **Step 1: Add custom capability `hyperhdr_effect` and flow cards to `app.json`**

Replace the `capabilities` and `flow` blocks in `app.json` with:

```json
  "capabilities": {
    "hyperhdr_effect": {
      "type": "enum",
      "title": { "en": "Effect" },
      "uiComponent": "picker",
      "getable": true,
      "setable": true,
      "values": [
        { "id": "__none__", "title": { "en": "No effect" } }
      ]
    }
  },
  "flow": {
    "triggers": [
      {
        "id": "effect_started",
        "title": { "en": "An effect started" },
        "args": [
          { "name": "device", "type": "device", "filter": "driver_id=hyperhdr" }
        ],
        "tokens": [
          { "name": "effect", "type": "string", "title": { "en": "Effect name" } }
        ]
      },
      {
        "id": "effect_stopped",
        "title": { "en": "An effect stopped" },
        "args": [
          { "name": "device", "type": "device", "filter": "driver_id=hyperhdr" }
        ],
        "tokens": [
          { "name": "effect", "type": "string", "title": { "en": "Effect name" } }
        ]
      },
      {
        "id": "component_changed",
        "title": { "en": "A component changed state" },
        "args": [
          { "name": "device", "type": "device", "filter": "driver_id=hyperhdr" }
        ],
        "tokens": [
          { "name": "component", "type": "string", "title": { "en": "Component" } },
          { "name": "state", "type": "boolean", "title": { "en": "State" } }
        ]
      }
    ],
    "conditions": [],
    "actions": [
      {
        "id": "start_effect",
        "title": { "en": "Start effect" },
        "args": [
          { "name": "device", "type": "device", "filter": "driver_id=hyperhdr" },
          { "name": "effect", "type": "autocomplete", "title": { "en": "Effect" } },
          { "name": "duration", "type": "number", "min": 0, "step": 100, "title": { "en": "Duration (ms, 0 = indefinite)" } }
        ]
      },
      {
        "id": "set_color",
        "title": { "en": "Set color" },
        "args": [
          { "name": "device", "type": "device", "filter": "driver_id=hyperhdr" },
          { "name": "color", "type": "color", "title": { "en": "Color" } },
          { "name": "duration", "type": "number", "min": 0, "step": 100, "title": { "en": "Duration (ms, 0 = indefinite)" } }
        ]
      },
      {
        "id": "clear_effect",
        "title": { "en": "Clear effect / restore color" },
        "args": [
          { "name": "device", "type": "device", "filter": "driver_id=hyperhdr" }
        ]
      }
    ]
  }
```

- [ ] **Step 2: Add localised strings to `locales/en.json`**

```json
{
  "app": { "name": "HyperHDR" },
  "errors": {
    "not_connected": "Cannot reach HyperHDR",
    "auth_failed": "Authentication failed; check the token",
    "no_devices_found": "No HyperHDR servers were discovered. Add one manually."
  }
}
```

- [ ] **Step 3: Validate manifest**

Run: `npx homey app validate -l debug`
Expected: validate passes (driver still missing — acceptable).

- [ ] **Step 4: Commit**

```bash
git add app.json locales
git commit -m "feat(manifest): hyperhdr_effect capability + flow cards"
```

---

## Task 8: Driver scaffold — compose, capabilities, discovery, pair

**Files:**
- Create: `drivers/hyperhdr/driver.compose.json`
- Create: `drivers/hyperhdr/driver.js`
- Create: `drivers/hyperhdr/assets/icon.svg`
- Modify: `app.json` (add driver entry)

- [ ] **Step 1: Write `drivers/hyperhdr/driver.compose.json`**

```json
{
  "id": "hyperhdr",
  "name": { "en": "HyperHDR Instance" },
  "class": "light",
  "capabilities": [
    "onoff",
    "dim",
    "light_hue",
    "light_saturation",
    "light_mode",
    "hyperhdr_effect"
  ],
  "images": {
    "small": "/drivers/hyperhdr/assets/icon.svg",
    "large": "/drivers/hyperhdr/assets/icon.svg"
  },
  "platforms": ["local"],
  "connectivity": ["lan"],
  "discovery": "hyperhdr",
  "pair": [
    { "id": "list_devices", "template": "list_devices", "navigation": { "next": "add_devices" } },
    { "id": "add_devices", "template": "add_devices" },
    { "id": "manual" },
    { "id": "auth" }
  ],
  "settings": [
    {
      "id": "host",
      "type": "text",
      "label": { "en": "Host" }
    },
    {
      "id": "port",
      "type": "number",
      "label": { "en": "Port" },
      "value": 8090
    },
    {
      "id": "priority",
      "type": "number",
      "label": { "en": "Priority (1–253)" },
      "value": 128,
      "min": 1,
      "max": 253
    },
    {
      "id": "origin",
      "type": "text",
      "label": { "en": "Origin label" },
      "value": "Homey"
    }
  ]
}
```

- [ ] **Step 2: Write driver placeholder icon** (copy `assets/icon.svg` content into `drivers/hyperhdr/assets/icon.svg`).

- [ ] **Step 3: Add discovery strategies + driver entry to `app.json`**

Append a top-level `discovery` block:

```json
  "discovery": {
    "hyperhdr": {
      "type": "mdns-sd",
      "mdns-sd": { "name": "hyperhdr-json", "protocol": "tcp" },
      "id": "{{txt.id}}",
      "conditions": []
    },
    "hyperhdr-ssdp": {
      "type": "ssdp",
      "ssdp": { "search": "urn:hyperion-project.org:device:basic:1" },
      "id": "{{headers.usn}}"
    }
  },
```

Add a `drivers` array entry — Homey CLI will normally compose this from `driver.compose.json`, but we are hand-writing `app.json`, so include a minimal reference:

```json
  "drivers": [
    {
      "id": "hyperhdr",
      "name": { "en": "HyperHDR Instance" },
      "class": "light",
      "capabilities": [
        "onoff", "dim", "light_hue", "light_saturation", "light_mode", "hyperhdr_effect"
      ],
      "platforms": ["local"],
      "connectivity": ["lan"],
      "discovery": "hyperhdr",
      "images": {
        "small": "/drivers/hyperhdr/assets/icon.svg",
        "large": "/drivers/hyperhdr/assets/icon.svg"
      },
      "pair": [
        { "id": "list_devices", "template": "list_devices", "navigation": { "next": "add_devices" } },
        { "id": "add_devices", "template": "add_devices" },
        { "id": "manual" },
        { "id": "auth" }
      ],
      "settings": [
        { "id": "host", "type": "text", "label": { "en": "Host" } },
        { "id": "port", "type": "number", "label": { "en": "Port" }, "value": 8090 },
        { "id": "priority", "type": "number", "label": { "en": "Priority (1-253)" }, "value": 128, "min": 1, "max": 253 },
        { "id": "origin", "type": "text", "label": { "en": "Origin label" }, "value": "Homey" }
      ]
    }
  ],
```

- [ ] **Step 4: Write `drivers/hyperhdr/driver.js` skeleton**

```javascript
'use strict';

const Homey = require('homey');

class HyperHdrDriver extends Homey.Driver {
  async onInit() {
    this.log('HyperHdrDriver init');
  }

  async onPairListDevices() {
    return [];
  }
}

module.exports = HyperHdrDriver;
```

- [ ] **Step 5: Validate**

Run: `npx homey app validate -l debug`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add drivers app.json
git commit -m "feat(driver): compose definition + skeleton, mDNS/SSDP discovery"
```

---

## Task 9: Driver — `onPairListDevices` enumerates instances

**Files:**
- Modify: `drivers/hyperhdr/driver.js`
- Create: `tests/HyperHdrDriver.test.js`

- [ ] **Step 1: Write the failing test**

`tests/HyperHdrDriver.test.js`:
```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startMockServer } = require('./helpers/mockHyperHdrServer');
const { listDevicesForServer } = require('../drivers/hyperhdr/pairing');

test('listDevicesForServer returns one device per running instance', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({
          command: 'authorize-tokenRequired', success: true, tan: msg.tan,
          info: { required: false }
        }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({
          command: 'serverinfo', success: true, tan: msg.tan,
          info: {
            cid: 'srv-abc',
            instance: [
              { instance: 0, friendly_name: 'Living Room', running: true },
              { instance: 1, friendly_name: 'Kitchen',     running: true },
              { instance: 2, friendly_name: 'Disabled',    running: false }
            ]
          }
        }));
      }
    }
  });

  const devices = await listDevicesForServer({ host: '127.0.0.1', port: mock.port });
  assert.equal(devices.length, 2);
  assert.equal(devices[0].name, 'HyperHDR — Living Room');
  assert.deepEqual(devices[0].data, { serverId: 'srv-abc', instance: 0 });
  assert.equal(devices[0].settings.host, '127.0.0.1');
  assert.equal(devices[0].settings.port, mock.port);
  await mock.stop();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/HyperHdrDriver.test.js`
Expected: FAIL — `Cannot find module '../drivers/hyperhdr/pairing'`.

- [ ] **Step 3: Write `drivers/hyperhdr/pairing.js`**

```javascript
'use strict';

const HyperHdrClient = require('../../lib/HyperHdrClient');

async function listDevicesForServer({ host, port = 8090, token = null } = {}) {
  const client = new HyperHdrClient({ host, port, token });
  await client.connect();
  try {
    if (await client.tokenRequired()) {
      if (!token) {
        const err = new Error('token required');
        err.code = 'EAUTHREQUIRED';
        throw err;
      }
      await client.authorize();
    }
    const reply = await client.request({ command: 'serverinfo' });
    const info = reply.info || {};
    const serverId = info.cid || `${host}:${port}`;
    const instances = (info.instance || []).filter(i => i.running);
    return instances.map(i => ({
      name: `HyperHDR — ${i.friendly_name}`,
      data: { serverId, instance: i.instance },
      settings: { host, port, priority: 128, origin: 'Homey' },
      store: token ? { token } : {}
    }));
  } finally {
    await client.close();
  }
}

module.exports = { listDevicesForServer };
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test tests/HyperHdrDriver.test.js`
Expected: 1 test, 1 ok.

- [ ] **Step 5: Wire into `driver.js`**

Replace `driver.js` with:

```javascript
'use strict';

const Homey = require('homey');
const { listDevicesForServer } = require('./pairing');

class HyperHdrDriver extends Homey.Driver {
  async onInit() {
    this.log('HyperHdrDriver init');
  }

  onPair(session) {
    let pairContext = { host: null, port: 8090, token: null };

    session.setHandler('list_devices', async () => {
      const discovered = this.getDiscoveryStrategy().getDiscoveryResults();
      const results = [];
      for (const d of Object.values(discovered)) {
        const host = d.address;
        const port = d.port || (d.txt && Number(d.txt.port)) || 8090;
        try {
          const devices = await listDevicesForServer({ host, port });
          results.push(...devices);
        } catch (err) {
          if (err.code === 'EAUTHREQUIRED') {
            // Surface in pair UI; user will pick "Add manually" + auth
            this.log(`Server ${host} requires auth, skipping silent enumeration`);
          } else {
            this.error(`Failed to enumerate ${host}:`, err.message);
          }
        }
      }
      return results;
    });

    session.setHandler('manual_submit', async ({ host, port }) => {
      pairContext = { host, port: Number(port) || 8090, token: null };
      try {
        const devices = await listDevicesForServer(pairContext);
        return { devices };
      } catch (err) {
        if (err.code === 'EAUTHREQUIRED') {
          await session.showView('auth');
          return { devices: null, requiresAuth: true };
        }
        throw err;
      }
    });

    session.setHandler('auth_submit', async ({ token }) => {
      pairContext.token = token;
      const devices = await listDevicesForServer(pairContext);
      return { devices };
    });
  }
}

module.exports = HyperHdrDriver;
```

- [ ] **Step 6: Run all tests**

Run: `node --test tests/`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add drivers tests
git commit -m "feat(driver): instance enumeration via pairing helper"
```

---

## Task 10: Pair views — manual + auth HTML

**Files:**
- Create: `drivers/hyperhdr/pair/manual.html`
- Create: `drivers/hyperhdr/pair/auth.html`

- [ ] **Step 1: Write `drivers/hyperhdr/pair/manual.html`**

```html
<header class="homey-header">
  <h1 data-i18n="pair.manual.title">Add HyperHDR manually</h1>
</header>

<form id="manualForm" class="homey-form">
  <div class="homey-form-group">
    <label class="homey-form-label" for="host">Host</label>
    <input class="homey-form-input" id="host" name="host" placeholder="hyperhdr.local or 192.168.1.50" required>
  </div>
  <div class="homey-form-group">
    <label class="homey-form-label" for="port">Port</label>
    <input class="homey-form-input" id="port" name="port" type="number" value="8090" required>
  </div>
  <button type="submit" class="homey-button-primary-full">Continue</button>
</form>

<script type="application/javascript">
  document.getElementById('manualForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const host = document.getElementById('host').value.trim();
    const port = Number(document.getElementById('port').value);
    try {
      const result = await Homey.emit('manual_submit', { host, port });
      if (result && result.devices) {
        Homey.setNavigationPrevButton(false);
        Homey.showView('list_devices');
      }
      // If requiresAuth, the driver already navigated to the auth view
    } catch (err) {
      Homey.alert(err.message || String(err));
    }
  });
</script>
```

- [ ] **Step 2: Write `drivers/hyperhdr/pair/auth.html`**

```html
<header class="homey-header">
  <h1 data-i18n="pair.auth.title">Authentication required</h1>
  <p data-i18n="pair.auth.body">Paste the bearer token from HyperHDR's web UI (Network Services &rarr; API Authentication).</p>
</header>

<form id="authForm" class="homey-form">
  <div class="homey-form-group">
    <label class="homey-form-label" for="token">Token</label>
    <input class="homey-form-input" id="token" name="token" required>
  </div>
  <button type="submit" class="homey-button-primary-full">Authenticate</button>
</form>

<script type="application/javascript">
  document.getElementById('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = document.getElementById('token').value.trim();
    try {
      const { devices } = await Homey.emit('auth_submit', { token });
      if (devices && devices.length) {
        Homey.showView('list_devices');
      } else {
        Homey.alert('No instances reported by server.');
      }
    } catch (err) {
      Homey.alert(err.message || String(err));
    }
  });
</script>
```

- [ ] **Step 3: Validate**

Run: `npx homey app validate -l debug`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add drivers
git commit -m "feat(pair): manual entry + auth views"
```

---

## Task 11: Brightness math helper (pure function, TDD)

**Files:**
- Create: `lib/color.js`
- Create: `tests/color.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/color.test.js`:
```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hsvToRgb, scaleRgb, hsvToScaledRgb } = require('../lib/color');

test('hsvToRgb red, green, blue, white', () => {
  assert.deepEqual(hsvToRgb(0,   1, 1), [255, 0, 0]);
  assert.deepEqual(hsvToRgb(120, 1, 1), [0, 255, 0]);
  assert.deepEqual(hsvToRgb(240, 1, 1), [0, 0, 255]);
  assert.deepEqual(hsvToRgb(0,   0, 1), [255, 255, 255]);
});

test('scaleRgb scales each channel', () => {
  assert.deepEqual(scaleRgb([200, 100, 0], 0.5), [100, 50, 0]);
  assert.deepEqual(scaleRgb([255, 255, 255], 0), [0, 0, 0]);
  assert.deepEqual(scaleRgb([255, 255, 255], 1), [255, 255, 255]);
});

test('hsvToScaledRgb takes Homey 0..1 hue/sat with dim', () => {
  // Homey hue is 0..1 = 0..360deg
  assert.deepEqual(hsvToScaledRgb({ hue: 0, saturation: 1, dim: 1 }), [255, 0, 0]);
  assert.deepEqual(hsvToScaledRgb({ hue: 0, saturation: 1, dim: 0.5 }), [128, 0, 0]);
  assert.deepEqual(hsvToScaledRgb({ hue: 0, saturation: 0, dim: 0.2 }), [51, 51, 51]);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/color.test.js`
Expected: FAIL — `Cannot find module '../lib/color'`.

- [ ] **Step 3: Write `lib/color.js`**

```javascript
'use strict';

function hsvToRgb(hueDeg, saturation, value) {
  const h = ((hueDeg % 360) + 360) % 360;
  const s = saturation;
  const v = value;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60)       [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else              [rp, gp, bp] = [c, 0, x];
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255)
  ];
}

function scaleRgb([r, g, b], factor) {
  const f = Math.max(0, Math.min(1, factor));
  return [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
}

function hsvToScaledRgb({ hue, saturation, dim }) {
  const rgb = hsvToRgb(hue * 360, saturation, 1);
  return scaleRgb(rgb, dim);
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`bad hex: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHsv([r, g, b]) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { hue: h / 360, saturation: s, value: v };
}

module.exports = { hsvToRgb, scaleRgb, hsvToScaledRgb, hexToRgb, rgbToHsv };
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test tests/color.test.js`
Expected: 3 tests, 3 ok.

- [ ] **Step 5: Commit**

```bash
git add lib tests
git commit -m "feat(color): HSV/RGB conversion + scaling helpers"
```

---

## Task 12: `HyperHdrDevice` — onInit, lifecycle, availability

**Files:**
- Create: `drivers/hyperhdr/device.js`
- Create: `tests/HyperHdrDevice.test.js`
- Create: `tests/helpers/mockHomey.js`

- [ ] **Step 1: Write the mock Homey device base**

`tests/helpers/mockHomey.js`:
```javascript
'use strict';

const { EventEmitter } = require('node:events');

class MockDevice extends EventEmitter {
  constructor({ data, settings = {}, store = {} } = {}) {
    super();
    this._data = data;
    this._settings = settings;
    this._store = store;
    this._capabilities = new Map();
    this._capabilityOptions = new Map();
    this._available = true;
    this._unavailableReason = null;
    this._listeners = new Map();
    this._triggers = [];
  }

  // Homey API surface used by the driver
  getData() { return this._data; }
  getSettings() { return this._settings; }
  getStoreValue(key) { return this._store[key]; }
  async setStoreValue(key, val) { this._store[key] = val; }
  getCapabilityValue(cap) { return this._capabilities.get(cap); }
  async setCapabilityValue(cap, val) { this._capabilities.set(cap, val); }
  async setCapabilityOptions(cap, opts) { this._capabilityOptions.set(cap, opts); }
  registerCapabilityListener(cap, fn) { this._listeners.set(cap, fn); }
  async setAvailable() { this._available = true; this._unavailableReason = null; }
  async setUnavailable(reason) { this._available = false; this._unavailableReason = reason; }
  log(...args) { /* noop */ }
  error(...args) { /* noop */ }

  // Test helpers
  triggerCapability(cap, val) {
    const fn = this._listeners.get(cap);
    if (!fn) throw new Error(`no listener for ${cap}`);
    return fn(val, {});
  }
  getCapabilityOptions(cap) { return this._capabilityOptions.get(cap); }
  isAvailable() { return this._available; }
  unavailableReason() { return this._unavailableReason; }
  flowTriggers() { return this._triggers; }
  driver = { triggerCardFire: (id, tokens) => this._triggers.push({ id, tokens }) };
}

module.exports = { MockDevice };
```

- [ ] **Step 2: Write the failing test**

`tests/HyperHdrDevice.test.js`:
```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startMockServer } = require('./helpers/mockHyperHdrServer');
const { MockDevice } = require('./helpers/mockHomey');
const { initDevice } = require('../drivers/hyperhdr/deviceCore');

function serverinfoReply(tan, instance = 0) {
  return {
    command: 'serverinfo', success: true, tan,
    info: {
      cid: 'srv-1',
      effects: [{ name: 'Rainbow' }, { name: 'Knight rider' }],
      instance: [{ instance, friendly_name: 'Living', running: true }],
      priorities: [],
      components: [
        { name: 'LEDDEVICE', enabled: true },
        { name: 'SMOOTHING', enabled: true }
      ]
    }
  };
}

test('initDevice connects, subscribes, populates effect options', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'instance') {
        ws.send(JSON.stringify({ command: 'instance', success: true, tan: msg.tan }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify(serverinfoReply(msg.tan)));
      }
    }
  });

  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });

  const ctx = await initDevice(device);
  const opts = device.getCapabilityOptions('hyperhdr_effect');
  assert.ok(opts, 'effect options were set');
  const ids = opts.values.map(v => v.id);
  assert.ok(ids.includes('__none__'));
  assert.ok(ids.includes('Rainbow'));
  assert.ok(ids.includes('Knight rider'));
  assert.equal(device.isAvailable(), true);

  await ctx.shutdown();
  await mock.stop();
});

test('initDevice marks unavailable when server is unreachable', async () => {
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: 1, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device, { reconnect: { initialDelayMs: 5, maxDelayMs: 20, jitter: false } });
  assert.equal(device.isAvailable(), false);
  assert.match(device.unavailableReason() || '', /reach/i);
  await ctx.shutdown();
});
```

- [ ] **Step 3: Run, verify failure**

Run: `node --test tests/HyperHdrDevice.test.js`
Expected: FAIL — module missing.

- [ ] **Step 4: Write `drivers/hyperhdr/deviceCore.js`** (pure logic, no Homey imports)

```javascript
'use strict';

const HyperHdrClient = require('../../lib/HyperHdrClient');

const SUBSCRIPTIONS = ['components-update', 'priorities-update', 'effects-update', 'instance-update'];

async function initDevice(device, opts = {}) {
  const settings = device.getSettings();
  const data = device.getData();
  const token = device.getStoreValue('token') || null;

  const client = new HyperHdrClient({
    host: settings.host,
    port: settings.port || 8090,
    token,
    reconnect: opts.reconnect
  });

  const state = {
    instance: data.instance,
    snapshot: null,
    lastBaseRgb: [255, 255, 255],
    lastEffect: null
  };

  client.on('error', err => device.error('client error', err.message));
  client.on('closed', () => device.setUnavailable(opts.unavailableMessage || 'Cannot reach HyperHDR'));
  client.on('connected', async () => {
    try {
      await bootstrap(client, device, state);
      await device.setAvailable();
    } catch (err) {
      device.error('bootstrap failed', err.message);
      await device.setUnavailable(err.message);
    }
  });
  client.on('update', msg => onPushUpdate(msg, device, state));

  try {
    await client.start();
    await bootstrap(client, device, state);
    await device.setAvailable();
  } catch (err) {
    await device.setUnavailable(opts.unavailableMessage || 'Cannot reach HyperHDR');
  }

  return {
    client,
    state,
    async shutdown() { await client.stop(); }
  };
}

async function bootstrap(client, device, state) {
  if (await client.tokenRequired()) {
    await client.authorize();
  }
  await client.request({ command: 'instance', subcommand: 'switchTo', instance: state.instance });
  await client.subscribe(['components-update', 'priorities-update', 'effects-update', 'instance-update']);
  const reply = await client.request({ command: 'serverinfo' });
  state.snapshot = reply.info || {};
  await refreshEffectOptions(device, state.snapshot.effects || []);
}

async function refreshEffectOptions(device, effects) {
  const values = [{ id: '__none__', title: { en: 'No effect' } }];
  for (const e of effects) {
    if (!e || !e.name) continue;
    values.push({ id: e.name, title: { en: e.name } });
  }
  await device.setCapabilityOptions('hyperhdr_effect', { values });
}

function onPushUpdate(msg, device, state) {
  // Filled in Task 16
}

module.exports = { initDevice, refreshEffectOptions, SUBSCRIPTIONS };
```

- [ ] **Step 5: Run, verify pass**

Run: `node --test tests/HyperHdrDevice.test.js`
Expected: 2 tests, 2 ok.

- [ ] **Step 6: Wire into `drivers/hyperhdr/device.js`**

```javascript
'use strict';

const Homey = require('homey');
const { initDevice } = require('./deviceCore');

class HyperHdrDevice extends Homey.Device {
  async onInit() {
    this._ctx = await initDevice(this);
    this._bindCapabilityListeners();
  }

  async onDeleted() {
    if (this._ctx) await this._ctx.shutdown();
  }

  async onSettings({ newSettings }) {
    if (this._ctx) await this._ctx.shutdown();
    this._ctx = await initDevice(this);
    this._bindCapabilityListeners();
  }

  _bindCapabilityListeners() {
    // Filled in Tasks 13-16
  }
}

module.exports = HyperHdrDevice;
```

- [ ] **Step 7: Run all tests**

Run: `node --test tests/`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add drivers tests
git commit -m "feat(device): onInit lifecycle, subscription bootstrap, effect options refresh"
```

---

## Task 13: Device — onoff capability

**Files:**
- Modify: `drivers/hyperhdr/deviceCore.js`
- Modify: `drivers/hyperhdr/device.js`
- Modify: `tests/HyperHdrDevice.test.js` (append)

- [ ] **Step 1: Write the failing test (append)**

```javascript
test('onoff true enables LEDDEVICE and reapplies last solid color', async () => {
  const sent = [];
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      sent.push(msg);
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'instance') {
        ws.send(JSON.stringify({ command: 'instance', success: true, tan: msg.tan }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({
          command: 'serverinfo', success: true, tan: msg.tan,
          info: { cid: 'srv-1', effects: [], instance: [{ instance: 0, running: true }], components: [] }
        }));
      } else {
        ws.send(JSON.stringify({ command: msg.command, success: true, tan: msg.tan }));
      }
    }
  });

  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  device.bindCapabilityListeners = bindCapabilityListeners; // helper
  bindCapabilityListeners(device, ctx);

  // Pretend we set a hue first
  await device.setCapabilityValue('light_hue', 0);
  await device.setCapabilityValue('light_saturation', 1);
  await device.setCapabilityValue('dim', 1);
  ctx.state.lastBaseRgb = [255, 0, 0];

  sent.length = 0;
  await device.triggerCapability('onoff', true);

  const componentstate = sent.find(m => m.command === 'componentstate');
  assert.ok(componentstate);
  assert.equal(componentstate.componentstate.component, 'LEDDEVICE');
  assert.equal(componentstate.componentstate.state, true);

  const colorCmd = sent.find(m => m.command === 'color');
  assert.ok(colorCmd, 'color reapplied after on');
  assert.deepEqual(colorCmd.color, [255, 0, 0]);

  await ctx.shutdown();
  await mock.stop();
});

test('onoff false disables LEDDEVICE and clears our priority', async () => {
  const sent = [];
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      sent.push(msg);
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({ command: 'serverinfo', success: true, tan: msg.tan,
          info: { cid: 'srv-1', effects: [], instance: [{ instance: 0, running: true }], components: [] } }));
      } else {
        ws.send(JSON.stringify({ command: msg.command, success: true, tan: msg.tan }));
      }
    }
  });

  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  sent.length = 0;
  await device.triggerCapability('onoff', false);

  const componentstate = sent.find(m => m.command === 'componentstate');
  assert.equal(componentstate.componentstate.state, false);
  const clearCmd = sent.find(m => m.command === 'clear');
  assert.ok(clearCmd);
  assert.equal(clearCmd.priority, 128);

  await ctx.shutdown();
  await mock.stop();
});
```

Add this import at the top of `tests/HyperHdrDevice.test.js`:
```javascript
const { bindCapabilityListeners } = require('../drivers/hyperhdr/deviceCore');
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/HyperHdrDevice.test.js`
Expected: `bindCapabilityListeners is not a function`.

- [ ] **Step 3: Add `bindCapabilityListeners` and onoff helper to `deviceCore.js`**

Append to `deviceCore.js`:

```javascript
function bindCapabilityListeners(device, ctx) {
  device.registerCapabilityListener('onoff', value => onOnOff(device, ctx, value));
}

async function onOnOff(device, ctx, value) {
  const settings = device.getSettings();
  await ctx.client.request({
    command: 'componentstate',
    componentstate: { component: 'LEDDEVICE', state: Boolean(value) }
  });
  if (value) {
    await applyLastColor(device, ctx);
  } else {
    await ctx.client.request({ command: 'clear', priority: settings.priority });
  }
}

async function applyLastColor(device, ctx) {
  const settings = device.getSettings();
  const rgb = ctx.state.lastBaseRgb || [255, 255, 255];
  const dim = device.getCapabilityValue('dim');
  const factor = typeof dim === 'number' ? dim : 1;
  const scaled = [
    Math.round(rgb[0] * factor),
    Math.round(rgb[1] * factor),
    Math.round(rgb[2] * factor)
  ];
  await ctx.client.request({
    command: 'color',
    priority: settings.priority,
    origin: settings.origin || 'Homey',
    color: scaled
  });
}

module.exports = { initDevice, refreshEffectOptions, bindCapabilityListeners, applyLastColor, SUBSCRIPTIONS };
```

- [ ] **Step 4: Wire into `device.js`**

Modify `_bindCapabilityListeners`:

```javascript
  _bindCapabilityListeners() {
    const { bindCapabilityListeners } = require('./deviceCore');
    bindCapabilityListeners(this, this._ctx);
  }
```

- [ ] **Step 5: Run, verify pass**

Run: `node --test tests/`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add drivers tests
git commit -m "feat(device): onoff capability via LEDDEVICE component + priority clear"
```

---

## Task 14: Device — dim, light_hue, light_saturation

**Files:**
- Modify: `drivers/hyperhdr/deviceCore.js`
- Modify: `tests/HyperHdrDevice.test.js` (append)

- [ ] **Step 1: Write the failing test (append)**

```javascript
test('setting hue triggers a color command with brightness applied', async () => {
  const sent = [];
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      sent.push(msg);
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({ command: 'serverinfo', success: true, tan: msg.tan,
          info: { cid: 'srv-1', effects: [], instance: [{ instance: 0, running: true }], components: [] } }));
      } else {
        ws.send(JSON.stringify({ command: msg.command, success: true, tan: msg.tan }));
      }
    }
  });
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 100, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  await device.setCapabilityValue('light_saturation', 1);
  await device.setCapabilityValue('dim', 0.5);
  sent.length = 0;
  await device.triggerCapability('light_hue', 0); // red

  const colorCmd = sent.find(m => m.command === 'color');
  assert.ok(colorCmd);
  assert.equal(colorCmd.priority, 100);
  assert.deepEqual(colorCmd.color, [128, 0, 0]);
  assert.equal(colorCmd.origin, 'Homey');

  await ctx.shutdown();
  await mock.stop();
});

test('dim updates color when in solid mode', async () => {
  const sent = [];
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      sent.push(msg);
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({ command: 'serverinfo', success: true, tan: msg.tan,
          info: { cid: 'srv-1', effects: [], instance: [{ instance: 0, running: true }], components: [] } }));
      } else {
        ws.send(JSON.stringify({ command: msg.command, success: true, tan: msg.tan }));
      }
    }
  });
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 100, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  await device.setCapabilityValue('light_hue', 0);
  await device.setCapabilityValue('light_saturation', 1);
  await device.setCapabilityValue('dim', 1);
  ctx.state.lastBaseRgb = [255, 0, 0];

  sent.length = 0;
  await device.triggerCapability('dim', 0.25);

  const colorCmd = sent.find(m => m.command === 'color');
  assert.ok(colorCmd);
  assert.deepEqual(colorCmd.color, [64, 0, 0]);

  await ctx.shutdown();
  await mock.stop();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/HyperHdrDevice.test.js`
Expected: `no listener for light_hue` / `no listener for dim`.

- [ ] **Step 3: Extend `bindCapabilityListeners`**

In `deviceCore.js` replace the existing `bindCapabilityListeners` and add helpers:

```javascript
const { hsvToScaledRgb } = require('../../lib/color');

function bindCapabilityListeners(device, ctx) {
  device.registerCapabilityListener('onoff', value => onOnOff(device, ctx, value));
  device.registerCapabilityListener('dim', value => onColorComponent(device, ctx, { dim: value }));
  device.registerCapabilityListener('light_hue', value => onColorComponent(device, ctx, { hue: value }));
  device.registerCapabilityListener('light_saturation', value => onColorComponent(device, ctx, { saturation: value }));
}

async function onColorComponent(device, ctx, override) {
  const hue = override.hue ?? device.getCapabilityValue('light_hue') ?? 0;
  const saturation = override.saturation ?? device.getCapabilityValue('light_saturation') ?? 1;
  const dim = override.dim ?? device.getCapabilityValue('dim') ?? 1;
  const settings = device.getSettings();

  const baseRgb = hsvToScaledRgb({ hue, saturation, dim: 1 });
  const finalRgb = hsvToScaledRgb({ hue, saturation, dim });
  ctx.state.lastBaseRgb = baseRgb;
  ctx.state.lastEffect = null;

  await ctx.client.request({
    command: 'color',
    priority: settings.priority,
    origin: settings.origin || 'Homey',
    color: finalRgb
  });
  // Reset effect picker to "no effect"
  if (device.getCapabilityValue('hyperhdr_effect') !== '__none__') {
    await device.setCapabilityValue('hyperhdr_effect', '__none__');
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test tests/`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add drivers tests
git commit -m "feat(device): solid color via hue/saturation/dim"
```

---

## Task 15: Device — `hyperhdr_effect` capability

**Files:**
- Modify: `drivers/hyperhdr/deviceCore.js`
- Modify: `tests/HyperHdrDevice.test.js` (append)

- [ ] **Step 1: Write the failing tests (append)**

```javascript
test('setting effect sends effect command at priority', async () => {
  const sent = [];
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      sent.push(msg);
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({ command: 'serverinfo', success: true, tan: msg.tan,
          info: { cid: 'srv-1', effects: [{ name: 'Rainbow' }], instance: [{ instance: 0, running: true }], components: [] } }));
      } else {
        ws.send(JSON.stringify({ command: msg.command, success: true, tan: msg.tan }));
      }
    }
  });
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  sent.length = 0;
  await device.triggerCapability('hyperhdr_effect', 'Rainbow');
  const effectCmd = sent.find(m => m.command === 'effect');
  assert.ok(effectCmd);
  assert.equal(effectCmd.priority, 128);
  assert.equal(effectCmd.effect.name, 'Rainbow');
  assert.equal(ctx.state.lastEffect, 'Rainbow');

  await ctx.shutdown();
  await mock.stop();
});

test('setting effect to __none__ clears priority and restores last color', async () => {
  const sent = [];
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      sent.push(msg);
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({ command: 'serverinfo', success: true, tan: msg.tan,
          info: { cid: 'srv-1', effects: [], instance: [{ instance: 0, running: true }], components: [] } }));
      } else {
        ws.send(JSON.stringify({ command: msg.command, success: true, tan: msg.tan }));
      }
    }
  });
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  await device.setCapabilityValue('dim', 1);
  ctx.state.lastBaseRgb = [10, 20, 30];
  ctx.state.lastEffect = 'Rainbow';

  sent.length = 0;
  await device.triggerCapability('hyperhdr_effect', '__none__');
  const clearCmd = sent.find(m => m.command === 'clear');
  assert.ok(clearCmd);
  assert.equal(clearCmd.priority, 128);
  const colorCmd = sent.find(m => m.command === 'color');
  assert.ok(colorCmd);
  assert.deepEqual(colorCmd.color, [10, 20, 30]);
  assert.equal(ctx.state.lastEffect, null);

  await ctx.shutdown();
  await mock.stop();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/HyperHdrDevice.test.js`
Expected: `no listener for hyperhdr_effect`.

- [ ] **Step 3: Extend `bindCapabilityListeners` and add `onEffect`**

In `deviceCore.js`:

```javascript
function bindCapabilityListeners(device, ctx) {
  device.registerCapabilityListener('onoff', value => onOnOff(device, ctx, value));
  device.registerCapabilityListener('dim', value => onColorComponent(device, ctx, { dim: value }));
  device.registerCapabilityListener('light_hue', value => onColorComponent(device, ctx, { hue: value }));
  device.registerCapabilityListener('light_saturation', value => onColorComponent(device, ctx, { saturation: value }));
  device.registerCapabilityListener('hyperhdr_effect', value => onEffect(device, ctx, value));
}

async function onEffect(device, ctx, name) {
  const settings = device.getSettings();
  if (!name || name === '__none__') {
    await ctx.client.request({ command: 'clear', priority: settings.priority });
    ctx.state.lastEffect = null;
    const dim = device.getCapabilityValue('dim') ?? 1;
    if (dim > 0 && ctx.state.lastBaseRgb) {
      const factor = dim;
      await ctx.client.request({
        command: 'color',
        priority: settings.priority,
        origin: settings.origin || 'Homey',
        color: [
          Math.round(ctx.state.lastBaseRgb[0] * factor),
          Math.round(ctx.state.lastBaseRgb[1] * factor),
          Math.round(ctx.state.lastBaseRgb[2] * factor)
        ]
      });
    }
    return;
  }
  await ctx.client.request({
    command: 'effect',
    priority: settings.priority,
    origin: settings.origin || 'Homey',
    effect: { name }
  });
  ctx.state.lastEffect = name;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test tests/`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add drivers tests
git commit -m "feat(device): hyperhdr_effect capability with __none__ restore"
```

---

## Task 16: Device — trigger emission from `serverinfo` push

**Files:**
- Modify: `drivers/hyperhdr/deviceCore.js`
- Modify: `drivers/hyperhdr/device.js`
- Modify: `tests/HyperHdrDevice.test.js` (append)

- [ ] **Step 1: Write failing tests (append)**

```javascript
test('component change push fires component_changed trigger', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({ command: 'serverinfo', success: true, tan: msg.tan,
          info: { cid: 'srv-1', effects: [], instance: [{ instance: 0, running: true }],
                  components: [{ name: 'LEDDEVICE', enabled: true }] } }));
      } else {
        ws.send(JSON.stringify({ command: msg.command, success: true, tan: msg.tan }));
      }
    }
  });
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  // Simulate a push update
  for (const ws of mock.wss.clients) {
    ws.send(JSON.stringify({ command: 'components-update', data: { name: 'LEDDEVICE', enabled: false } }));
  }
  await new Promise(r => setTimeout(r, 30));

  const triggers = device.flowTriggers();
  const cc = triggers.find(t => t.id === 'component_changed');
  assert.ok(cc, 'component_changed fired');
  assert.equal(cc.tokens.component, 'LEDDEVICE');
  assert.equal(cc.tokens.state, false);

  await ctx.shutdown();
  await mock.stop();
});

test('priorities-update with new effect fires effect_started; clearing fires effect_stopped', async () => {
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({ command: 'serverinfo', success: true, tan: msg.tan,
          info: { cid: 'srv-1', effects: [], instance: [{ instance: 0, running: true }],
                  components: [], priorities: [] } }));
      } else {
        ws.send(JSON.stringify({ command: msg.command, success: true, tan: msg.tan }));
      }
    }
  });
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 128, origin: 'Homey' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  for (const ws of mock.wss.clients) {
    ws.send(JSON.stringify({
      command: 'priorities-update',
      data: { priorities: [{ priority: 200, owner: 'EFFECT', componentId: 'EFFECT', visible: true, value: { effect: 'Rainbow' } }] }
    }));
  }
  await new Promise(r => setTimeout(r, 20));
  let triggers = device.flowTriggers();
  assert.ok(triggers.find(t => t.id === 'effect_started' && t.tokens.effect === 'Rainbow'));

  for (const ws of mock.wss.clients) {
    ws.send(JSON.stringify({ command: 'priorities-update', data: { priorities: [] } }));
  }
  await new Promise(r => setTimeout(r, 20));
  triggers = device.flowTriggers();
  assert.ok(triggers.find(t => t.id === 'effect_stopped' && t.tokens.effect === 'Rainbow'));

  await ctx.shutdown();
  await mock.stop();
});
```

- [ ] **Step 2: Implement push handling in `deviceCore.js`**

Replace the empty `onPushUpdate` with:

```javascript
function onPushUpdate(msg, device, state) {
  switch (msg.command) {
    case 'components-update':
      handleComponentsUpdate(msg.data, device);
      break;
    case 'priorities-update':
      handlePrioritiesUpdate(msg.data, device, state);
      break;
    case 'effects-update':
      if (Array.isArray(msg.data && msg.data.effects)) {
        refreshEffectOptions(device, msg.data.effects).catch(err => device.error(err.message));
      }
      break;
    case 'instance-update':
      // No-op: Homey devices are pinned to a specific instance
      break;
  }
}

function handleComponentsUpdate(data, device) {
  if (!data || !data.name) return;
  const tracked = ['LEDDEVICE', 'SMOOTHING', 'HDR'];
  if (!tracked.includes(data.name)) return;
  device.driver.triggerCardFire('component_changed',
    { component: data.name, state: Boolean(data.enabled) },
    {}
  );
}

function handlePrioritiesUpdate(data, device, state) {
  const next = pickEffect(data && data.priorities);
  const prev = state.activeEffect || null;
  if (next && next !== prev) {
    device.driver.triggerCardFire('effect_started', { effect: next }, {});
  }
  if (!next && prev) {
    device.driver.triggerCardFire('effect_stopped', { effect: prev }, {});
  }
  state.activeEffect = next;
}

function pickEffect(priorities) {
  if (!Array.isArray(priorities)) return null;
  for (const p of priorities) {
    if (!p.visible) continue;
    if (p.componentId === 'EFFECT' || (p.owner && /effect/i.test(p.owner))) {
      return (p.value && p.value.effect) || p.owner || 'effect';
    }
  }
  return null;
}

module.exports = {
  initDevice,
  refreshEffectOptions,
  bindCapabilityListeners,
  onPushUpdate,
  applyLastColor,
  pickEffect,
  SUBSCRIPTIONS
};
```

The MockDevice already exposes `driver.triggerCardFire`. In real `device.js` we need to wire to Homey's flow API.

- [ ] **Step 3: Wire real triggers in `device.js`**

Replace `device.js` `onInit` with one that registers trigger cards via the driver:

```javascript
'use strict';

const Homey = require('homey');
const { initDevice, bindCapabilityListeners } = require('./deviceCore');

class HyperHdrDevice extends Homey.Device {
  async onInit() {
    // Adapt the Homey trigger API to the test-friendly `driver.triggerCardFire(id, tokens, state)`
    this.driver.triggerCardFire = async (id, tokens, state) => {
      const card = this.homey.flow.getDeviceTriggerCard(id);
      await card.trigger(this, tokens, state || {});
    };
    this._ctx = await initDevice(this);
    bindCapabilityListeners(this, this._ctx);
  }

  async onDeleted() { if (this._ctx) await this._ctx.shutdown(); }

  async onSettings({ newSettings }) {
    if (this._ctx) await this._ctx.shutdown();
    this._ctx = await initDevice(this);
    bindCapabilityListeners(this, this._ctx);
  }
}

module.exports = HyperHdrDevice;
```

- [ ] **Step 4: Run all tests**

Run: `node --test tests/`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add drivers tests
git commit -m "feat(device): trigger flow cards from serverinfo push (effect started/stopped, component changed)"
```

---

## Task 17: Flow action — `start_effect` with autocomplete

**Files:**
- Modify: `drivers/hyperhdr/driver.js`

- [ ] **Step 1: Register the action in `driver.onInit`**

Replace the existing `onInit` with:

```javascript
  async onInit() {
    this.log('HyperHdrDriver init');

    const startEffect = this.homey.flow.getActionCard('start_effect');
    startEffect.registerArgumentAutocompleteListener('effect', async (query, args) => {
      const device = args.device;
      const effects = device._ctx?.state?.snapshot?.effects || [];
      const items = effects
        .filter(e => e && e.name)
        .filter(e => !query || e.name.toLowerCase().includes(query.toLowerCase()))
        .map(e => ({ name: e.name }));
      return items;
    });
    startEffect.registerRunListener(async (args) => {
      const device = args.device;
      const settings = device.getSettings();
      const payload = {
        command: 'effect',
        priority: settings.priority,
        origin: settings.origin || 'Homey',
        effect: { name: args.effect.name }
      };
      if (args.duration && args.duration > 0) payload.duration = args.duration;
      await device._ctx.client.request(payload);
      device._ctx.state.lastEffect = args.effect.name;
    });
  }
```

- [ ] **Step 2: Validate**

Run: `npx homey app validate -l debug`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add drivers
git commit -m "feat(flow): start_effect action with autocomplete"
```

---

## Task 18: Flow actions — `set_color` and `clear_effect`

**Files:**
- Modify: `drivers/hyperhdr/driver.js`

- [ ] **Step 1: Append both action registrations inside `onInit`**

After the `start_effect` block:

```javascript
    const setColor = this.homey.flow.getActionCard('set_color');
    setColor.registerRunListener(async (args) => {
      const device = args.device;
      const settings = device.getSettings();
      const { hexToRgb, rgbToHsv } = require('../../lib/color');
      const baseRgb = hexToRgb(args.color);
      const dim = device.getCapabilityValue('dim') ?? 1;
      const finalRgb = baseRgb.map(c => Math.round(c * dim));
      const payload = {
        command: 'color',
        priority: settings.priority,
        origin: settings.origin || 'Homey',
        color: finalRgb
      };
      if (args.duration && args.duration > 0) payload.duration = args.duration;
      await device._ctx.client.request(payload);

      // Sync capability state
      const hsv = rgbToHsv(baseRgb);
      device._ctx.state.lastBaseRgb = baseRgb;
      device._ctx.state.lastEffect = null;
      await device.setCapabilityValue('light_hue', hsv.hue);
      await device.setCapabilityValue('light_saturation', hsv.saturation);
      if (device.getCapabilityValue('hyperhdr_effect') !== '__none__') {
        await device.setCapabilityValue('hyperhdr_effect', '__none__');
      }
    });

    const clearEffect = this.homey.flow.getActionCard('clear_effect');
    clearEffect.registerRunListener(async (args) => {
      const device = args.device;
      const settings = device.getSettings();
      await device._ctx.client.request({ command: 'clear', priority: settings.priority });
      device._ctx.state.lastEffect = null;
      const dim = device.getCapabilityValue('dim') ?? 1;
      if (dim > 0 && device._ctx.state.lastBaseRgb) {
        const f = dim;
        await device._ctx.client.request({
          command: 'color',
          priority: settings.priority,
          origin: settings.origin || 'Homey',
          color: device._ctx.state.lastBaseRgb.map(c => Math.round(c * f))
        });
      }
    });
```

- [ ] **Step 2: Validate**

Run: `npx homey app validate -l debug`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add drivers
git commit -m "feat(flow): set_color and clear_effect actions"
```

---

## Task 19: Settings change handler verification

**Files:**
- Modify: `tests/HyperHdrDevice.test.js` (append)

- [ ] **Step 1: Add a test exercising the priority setting actually flowing into commands**

```javascript
test('priority setting is honoured by color commands', async () => {
  const sent = [];
  const mock = await startMockServer({
    onMessage: (msg, ws) => {
      sent.push(msg);
      if (msg.command === 'authorize' && msg.subcommand === 'tokenRequired') {
        ws.send(JSON.stringify({ command: 'authorize-tokenRequired', success: true, tan: msg.tan, info: { required: false } }));
      } else if (msg.command === 'serverinfo') {
        ws.send(JSON.stringify({ command: 'serverinfo', success: true, tan: msg.tan,
          info: { cid: 'srv-1', effects: [], instance: [{ instance: 0, running: true }], components: [] } }));
      } else {
        ws.send(JSON.stringify({ command: msg.command, success: true, tan: msg.tan }));
      }
    }
  });
  const device = new MockDevice({
    data: { serverId: 'srv-1', instance: 0 },
    settings: { host: '127.0.0.1', port: mock.port, priority: 75, origin: 'TestOrigin' }
  });
  const ctx = await initDevice(device);
  bindCapabilityListeners(device, ctx);

  await device.setCapabilityValue('light_saturation', 1);
  await device.setCapabilityValue('dim', 1);
  sent.length = 0;
  await device.triggerCapability('light_hue', 0);

  const colorCmd = sent.find(m => m.command === 'color');
  assert.equal(colorCmd.priority, 75);
  assert.equal(colorCmd.origin, 'TestOrigin');

  await ctx.shutdown();
  await mock.stop();
});
```

- [ ] **Step 2: Run, verify pass** (no implementation change needed — verifies existing wiring)

Run: `node --test tests/`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add tests
git commit -m "test(device): priority and origin settings honoured"
```

---

## Task 20: Locales + README polish

**Files:**
- Modify: `locales/en.json`
- Modify: `README.md`

- [ ] **Step 1: Expand `locales/en.json`**

```json
{
  "app": {
    "name": "HyperHDR"
  },
  "errors": {
    "not_connected": "Cannot reach HyperHDR",
    "auth_failed": "Authentication failed; check the token",
    "no_devices_found": "No HyperHDR servers were discovered. Add one manually."
  },
  "pair": {
    "manual": {
      "title": "Add HyperHDR manually"
    },
    "auth": {
      "title": "Authentication required",
      "body": "Paste the bearer token from HyperHDR's web UI (Network Services → API Authentication)."
    }
  },
  "flow": {
    "actions": {
      "start_effect": "Start effect",
      "set_color": "Set color",
      "clear_effect": "Clear effect / restore color"
    },
    "triggers": {
      "effect_started": "An effect started",
      "effect_stopped": "An effect stopped",
      "component_changed": "A component changed state"
    }
  }
}
```

- [ ] **Step 2: Expand `README.md`**

```markdown
# HyperHDR Homey

Homey Apps SDK v3 integration for [HyperHDR](https://github.com/awawa-dev/HyperHDR).
Local control of LED installations: on/off, dimming, hue/saturation, and effects.

## Features

- One Homey device per HyperHDR instance.
- mDNS / SSDP discovery, manual host entry as fallback.
- Optional bearer token authentication.
- Standard Homey light tile (on/off, dim, hue, saturation) plus an Effect picker that follows the server's effect list.
- Flow actions: Start effect (autocomplete), Set color, Clear effect.
- Flow triggers: An effect started, An effect stopped, A component changed state.

## Non-goals (v1)

Ambilight / grabber control, calibration UI, multi-server hub aggregation, effect editing.

## Configuration

Each device exposes:

- **Host / Port** — HyperHDR JSON-RPC endpoint (default port 8090).
- **Priority** — 1–253. Default 128, matching Home Assistant. Lower = higher precedence.
- **Origin label** — appears in HyperHDR's active-source list.

The bearer token (if any) is captured during pairing and stored privately.

## Developing

```bash
npm install
npm test
npx homey app run
```

## License

MIT — see `LICENSE`.
```

- [ ] **Step 3: Commit**

```bash
git add locales README.md
git commit -m "docs: expand README and locales"
```

---

## Task 21: Final validation + smoke harness

**Files:**
- Create: `tests/integration.smoke.test.js`

- [ ] **Step 1: Write an opt-in real-server smoke test**

`tests/integration.smoke.test.js`:
```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const HyperHdrClient = require('../lib/HyperHdrClient');

const host = process.env.HYPERHDR_HOST;
const port = Number(process.env.HYPERHDR_PORT || 8090);
const token = process.env.HYPERHDR_TOKEN || null;

test('integration smoke: red, effect, clear', { skip: !host }, async () => {
  const client = new HyperHdrClient({ host, port, token });
  await client.start();
  if (await client.tokenRequired()) await client.authorize();

  await client.request({ command: 'color', priority: 128, origin: 'HomeySmoke', color: [255, 0, 0] });
  await new Promise(r => setTimeout(r, 1500));

  const info = await client.request({ command: 'serverinfo' });
  const effects = info.info.effects || [];
  if (effects.length) {
    await client.request({ command: 'effect', priority: 128, origin: 'HomeySmoke', effect: { name: effects[0].name } });
    await new Promise(r => setTimeout(r, 1500));
  }

  await client.request({ command: 'clear', priority: 128 });
  await client.stop();
  assert.ok(true);
});
```

- [ ] **Step 2: Run unit tests + validate**

Run:
```bash
node --test tests/
npx homey app validate -l debug
```
Expected: all unit tests green; validate passes with no errors.

- [ ] **Step 3: Document smoke usage in README**

Append to `README.md`:

```markdown
## Smoke testing against a real server

```bash
HYPERHDR_HOST=hyperhdr.local HYPERHDR_TOKEN=… node --test tests/integration.smoke.test.js
```
```

- [ ] **Step 4: Manual validation on Homey Pro**

Run: `npx homey app run --remote`

Verify by hand:
- Pairing finds a discovered server (or use manual entry).
- Token-required server prompts for auth.
- Each instance appears as a separate device.
- On/off, dim, hue, saturation produce visible LED changes.
- Effect picker lists the server's effects; selecting one runs it.
- Flow card "Start effect" autocomplete shows the effects.
- Triggers fire when toggling effects from HyperHDR's web UI.

Document any divergences from the spec in `docs/specs/2026-05-10-hyperhdr-homey-design.md` under a "Notes from manual validation" section.

- [ ] **Step 5: Commit**

```bash
git add tests README.md docs
git commit -m "test: integration smoke harness + manual validation notes"
```

---

## Self-review (completed by plan author)

- **Spec coverage:** every spec section maps to one or more tasks — capabilities (T13–T15), pairing (T8–T10), connection lifecycle (T6, T12), settings (T8, T19), flow cards (T17–T18 actions, T16 triggers), brightness math (T11), out-of-scope items not implemented as designed.
- **Placeholder scan:** no TBD/TODO; every step contains either runnable code or an exact command + expected outcome.
- **Type consistency:** `device._ctx.client`, `device._ctx.state`, `state.lastBaseRgb`, `state.lastEffect`, `state.snapshot`, `state.activeEffect`, `triggerCardFire(id, tokens, state)` — used consistently across all device tasks.
- **Note:** Task 16 introduces `state.activeEffect` (used to diff priority changes); set initially in `pickEffect` flow, default `null`.
