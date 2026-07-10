#!/usr/bin/env node
// Verify review_media returns real image thumbnails the client AI can see, and
// rank_media applies the AI's own scoring into script.json.
import {spawn} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLUG = process.argv[2] || 'mcp-mptn8l2h';
const server = spawn('node', [join(__dirname, 'server.mjs')], {stdio: ['pipe', 'pipe', 'inherit']});
let buf = '';
const pending = new Map();
let id = 0;
function send(method, params) {
  return new Promise((resolve, reject) => {
    const reqId = ++id;
    pending.set(reqId, {resolve, reject});
    server.stdin.write(JSON.stringify({jsonrpc: '2.0', id: reqId, method, params}) + '\n');
    setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); reject(new Error(`timeout: ${method}`)); } }, 60000);
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
    await send('initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'vision-rank-test', version: '0'}});
    server.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');

    const tools = (await send('tools/list', {})).tools.map((t) => t.name);
    console.log('Tools include review_media:', tools.includes('review_media'), '| rank_media:', tools.includes('rank_media'));

    console.log('\nreview_media…');
    const review = await send('tools/call', {name: 'review_media', arguments: {slug: SLUG, max: 4, thumbWidth: 240}});
    const imgs = review.content.filter((c) => c.type === 'image');
    const texts = review.content.filter((c) => c.type === 'text');
    console.log(`  content blocks: ${review.content.length} (${imgs.length} images, ${texts.length} text)`);
    if (imgs[0]) console.log(`  first image: mime=${imgs[0].mimeType}, base64 len=${imgs[0].data.length}`);
    // Extract the file paths from the meta text lines to rank them.
    const files = texts.map((t) => (t.text.match(/^\[\d+\]\s+(\S+)/) || [])[1]).filter(Boolean);
    console.log('  files seen:', files.map((f) => f.split('/').pop()).join(', '));

    if (!files.length) { console.log('\nNo scraped files to rank — skipping rank_media.'); server.kill('SIGTERM'); process.exit(imgs.length > 0 ? 0 : 1); }

    console.log('\nrank_media (simulating the AI keeping the first 2, scoring them)…');
    const rankings = files.slice(0, 3).map((f, i) => ({file: f, score: i === 2 ? 4 : 9 - i, keep: i !== 2, role: 'frame'}));
    const ranked = await send('tools/call', {name: 'rank_media', arguments: {slug: SLUG, rankings}});
    const r = JSON.parse(ranked.content[0].text);
    console.log('  result:', JSON.stringify(r));

    const ok = tools.includes('review_media') && tools.includes('rank_media') && imgs.length > 0 && r.ok;
    console.log(ok ? '\n✅ Client-AI vision review + ranking works end to end' : '\n❌ Something failed');
    server.kill('SIGTERM');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('FAIL:', e.message);
    server.kill('SIGTERM');
    process.exit(1);
  }
})();
