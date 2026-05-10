'use strict';

const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

class HyperHdrClient extends EventEmitter {
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

  async tokenRequired() {
    const reply = await this.request({ command: 'authorize', subcommand: 'tokenRequired' });
    return Boolean(reply && reply.info && reply.info.required);
  }

  subscribe(events) {
    return this.request({ command: 'serverinfo', subscribe: events });
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
