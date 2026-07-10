#!/usr/bin/env node
// Tiny MCP client to smoke-test our stdio server. Spawns server.mjs, sends
// initialize → tools/list → tools/call list_layouts, prints results, exits.
// Lets us verify the server end-to-end without needing Claude Code installed.
import {spawn} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const server = spawn('node', [join(__dirname, 'server.mjs')], {stdio: ['pipe', 'pipe', 'inherit']});

let buf = '';
const pending = new Map();
let id = 0;

function send(method, params) {
  return new Promise((resolve, reject) => {
    const reqId = ++id;
    pending.set(reqId, {resolve, reject});
    const msg = JSON.stringify({jsonrpc: '2.0', id: reqId, method, params});
    server.stdin.write(msg + '\n');
    setTimeout(() => {
      if (pending.has(reqId)) { pending.delete(reqId); reject(new Error(`timeout: ${method}`)); }
    }, 30000);
  });
}

server.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop() || '';
  for (const ln of lines) {
    if (!ln.trim()) continue;
    try {
      const msg = JSON.parse(ln);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    } catch (e) { console.error('parse err:', ln, e.message); }
  }
});

(async () => {
  try {
    const init = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {name: 'smoke-test', version: '0.0.1'},
    });
    console.log('INIT OK:', init.serverInfo?.name, init.protocolVersion);

    server.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');

    const tools = await send('tools/list', {});
    console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

    const layouts = await send('tools/call', {name: 'list_layouts', arguments: {}});
    const text = layouts.content?.[0]?.text || '';
    console.log('LAYOUTS RESPONSE LEN:', text.length);
    const parsed = JSON.parse(text);
    console.log('archetypes:', Object.keys(parsed.archetypes).join(', '));
    console.log('dataLayouts:', Object.keys(parsed.dataLayouts).join(', '));
    console.log('textEffects:', parsed.textEffects.join(', '));

    server.kill('SIGTERM');
    process.exit(0);
  } catch (e) {
    console.error('FAIL:', e.message);
    server.kill('SIGTERM');
    process.exit(1);
  }
})();
