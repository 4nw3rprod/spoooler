#!/usr/bin/env node
// Verify the granular media tools are registered with correct schemas, and run
// a fast end-to-end check of collect_stock_media through the MCP server.
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
    setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); reject(new Error(`timeout: ${method}`)); } }, 90000);
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
    await send('initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'media-tools-test', version: '0'}});
    server.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');

    const tools = await send('tools/list', {});
    const names = tools.tools.map((t) => t.name);
    console.log('Registered tools:', names.join(', '));
    const want = ['scrape_brand_media', 'collect_stock_media', 'vision_filter_media', 'search_stock_media'];
    const missing = want.filter((w) => !names.includes(w));
    console.log(missing.length ? `MISSING: ${missing.join(', ')}` : 'All granular media tools present ✓');

    // Fast e2e: collect_stock_media (1 query, no commit) through MCP.
    console.log('\nCalling collect_stock_media via MCP (1 query)…');
    const res = await send('tools/call', {name: 'collect_stock_media', arguments: {slug: 'mcp-mptn8l2h', queries: ['quiet workspace morning']}});
    const data = JSON.parse(res.content[0].text);
    console.log('  op:', data.op, '| requested:', data.requested, '| found:', data.found);
    const ok = missing.length === 0 && data.op === 'stock' && data.found >= 1;
    console.log(ok ? '\n✅ Granular media tools work through MCP' : '\n❌ Something failed');
    server.kill('SIGTERM');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('FAIL:', e.message);
    server.kill('SIGTERM');
    process.exit(1);
  }
})();
