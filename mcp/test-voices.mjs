#!/usr/bin/env node
// Smoke test: list_voices returns cloned Anwar/Irina + Kokoro presets, and
// verify resolveClonedVoice-style matching works through the tool.
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
    server.stdin.write(JSON.stringify({jsonrpc: '2.0', id: reqId, method, params}) + '\n');
    setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); reject(new Error(`timeout: ${method}`)); } }, 30000);
  });
}
server.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop() || '';
  for (const ln of lines) {
    if (!ln.trim()) continue;
    try {
      const msg = JSON.parse(ln);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
      }
    } catch { /* ignore */ }
  }
});

(async () => {
  try {
    await send('initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'voice-test', version: '0'}});
    server.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');

    const res = await send('tools/call', {name: 'list_voices', arguments: {}});
    const data = JSON.parse(res.content[0].text);
    console.log('Cloned voices:');
    for (const v of data.clonedVoices) console.log(`  - ${v.name} (id: ${v.id}, file: ${v.embeddingFile}, available: ${v.available})`);
    console.log('Kokoro presets:', data.kokoroPresets.length);

    const hasAnwar = data.clonedVoices.some((v) => /anwar/i.test(v.name) && v.available);
    const hasIrina = data.clonedVoices.some((v) => /irina/i.test(v.name) && v.available);
    console.log('\nAnwar available:', hasAnwar);
    console.log('Irina available:', hasIrina);
    console.log(hasAnwar && hasIrina ? '\nPASS — both voices usable via MCP' : '\nFAIL — missing a voice');

    server.kill('SIGTERM');
    process.exit(hasAnwar && hasIrina ? 0 : 1);
  } catch (e) {
    console.error('FAIL:', e.message);
    server.kill('SIGTERM');
    process.exit(1);
  }
})();
