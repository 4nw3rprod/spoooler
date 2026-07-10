#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// MCP script-stage verification.
//
// Drives the MCP server through: create_run → set_strategy (mediaCollection
// auto) → get_run_state, then INDEPENDENTLY confirms on disk that:
//   (1) the script stage wrote run state (script.json + checkpoint.json)
//   (2) stock media was actually collected (files exist in public/)
// WITHOUT rendering. This is the "prove it before I commit to a full render"
// check — everything happens through the MCP tools, the disk checks are just
// an external audit of what the tools claim.
// ─────────────────────────────────────────────────────────────────────────────
import {spawn} from 'node:child_process';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(__dirname, '..');
const PROJECT_ROOT = resolve(TOOL_ROOT, '..');

const server = spawn('node', [join(__dirname, 'server.mjs')], {stdio: ['pipe', 'pipe', 'inherit']});
let buf = '';
const pending = new Map();
let id = 0;
function send(method, params) {
  return new Promise((resolve, reject) => {
    const reqId = ++id;
    pending.set(reqId, {resolve, reject});
    server.stdin.write(JSON.stringify({jsonrpc: '2.0', id: reqId, method, params}) + '\n');
    // set_strategy runs the whole script stage (LLM-skip + scrape + stock) so allow time.
    setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); reject(new Error(`timeout: ${method}`)); } }, 300000);
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
    } catch { /* non-JSON line */ }
  }
});

const callTool = async (name, args) => {
  const res = await send('tools/call', {name, arguments: args});
  return JSON.parse(res.content[0].text);
};

(async () => {
  try {
    await send('initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'script-stage-test', version: '0'}});
    server.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');

    // 1) create_run
    const {slug} = await callTool('create_run', {slug: 'mcp-scriptcheck'});
    console.log(`\n[1] create_run → slug=${slug}`);

    // 2) set_strategy with auto media collection + a real brand URL so scraping
    //    has something to discover and stock has topical queries.
    console.log('[2] set_strategy (mediaCollection: auto) — running LLM-skip script stage + media collection…');
    const strat = await callTool('set_strategy', {
      slug,
      hook: 'Three AI agents that quietly run your busywork.',
      voiceover: "Three AI agents that quietly run your busywork. Notion AI drafts your docs before you ask. Zapier moves data between every tool you own. And a research agent reads the web so you don't have to. Comment STACK and I'll send the setup.",
      angle: 'AI agent stack for solo operators drowning in busywork',
      brands: ['Notion', 'Zapier'],
      brandUrl: 'https://www.notion.so/product/ai',
      commentTrigger: 'STACK',
      autoDuration: true,
      mediaCollection: 'auto',
      scenes: [
        {type: 'hook', layout: 'hook', onScreen: 'Three AI agents that quietly run your busywork.', spoken: 'Three AI agents that quietly run your busywork.', search: 'futuristic automation abstract'},
        {type: 'proof', layout: 'proof', onScreen: 'Notion AI drafts your docs before you ask.', spoken: 'Notion AI drafts your docs before you ask.', brands: ['Notion'], search: 'person writing notes laptop'},
        {type: 'statement', layout: 'checklist', onScreen: 'Zapier moves data between every tool you own.', spoken: 'Zapier moves data between every tool you own.', brands: ['Zapier'], search: 'connected workflow diagram'},
        {type: 'proof', layout: 'proof', onScreen: "A research agent reads the web so you don't have to.", spoken: "And a research agent reads the web so you don't have to.", search: 'data dashboard screens'},
        {type: 'cta', layout: 'cta', onScreen: "Comment STACK for the setup.", spoken: "Comment STACK and I'll send the setup."},
      ],
    });
    console.log('    set_strategy result:', JSON.stringify({
      sceneCount: strat.sceneCount, scrapedCount: strat.scrapedCount, stockCount: strat.stockCount,
      mediaItems: (strat.media || []).length, resolvedBrands: strat.resolvedBrands,
    }));

    // 3) get_run_state — the AI's confirmation surface.
    const state = await callTool('get_run_state', {slug});
    console.log('\n[3] get_run_state:');
    console.log('    checkpoint stages:', Object.entries(state.checkpoint || {}).map(([k, v]) => `${k}${v.completed ? '✓' : ''}`).join(', '));
    console.log('    script summary:', JSON.stringify(state.script));
    console.log('    source present:', Boolean(state.source));

    // ── INDEPENDENT DISK AUDIT (external truth, not what the tool claims) ──────
    console.log('\n[AUDIT] Verifying on disk (independent of tool output):');
    const runDir = join(TOOL_ROOT, 'runs', slug);
    const scriptJson = join(runDir, 'script.json');
    const checkpointJson = join(runDir, 'checkpoint.json');
    const renderJson = join(runDir, 'render.json');

    const checks = [];
    checks.push(['script.json written', existsSync(scriptJson)]);
    checks.push(['checkpoint.json written', existsSync(checkpointJson)]);
    checks.push(['NO render yet (render.json absent)', !existsSync(renderJson)]);

    let mediaOnDisk = 0;
    let mediaListed = 0;
    if (existsSync(scriptJson)) {
      const s = JSON.parse(readFileSync(scriptJson, 'utf-8'));
      const media = s.media || [];
      mediaListed = media.length;
      for (const m of media) {
        const candidates = [
          join(TOOL_ROOT, 'public', m.file),
          join(PROJECT_ROOT, 'public', m.file),
        ];
        const hit = candidates.find((p) => existsSync(p) && statSync(p).size > 0);
        if (hit) mediaOnDisk += 1;
      }
      const stock = media.filter((m) => m.source === 'stock').length;
      const scraped = media.filter((m) => m.source === 'scrapling' || m.source === 'search').length;
      console.log(`    media listed in script.json: ${mediaListed} (${stock} stock, ${scraped} scraped/search)`);
      console.log(`    media files actually present on disk: ${mediaOnDisk}/${mediaListed}`);
      checks.push(['script.json has strategy.scenes', (s.strategy?.scenes || []).length > 0]);
      checks.push(['media collected (≥1 item listed)', mediaListed > 0]);
      checks.push(['media files exist on disk', mediaOnDisk > 0]);
    }

    console.log('\n[RESULT]');
    let allPass = true;
    for (const [label, ok] of checks) {
      console.log(`    ${ok ? 'PASS' : 'FAIL'} — ${label}`);
      if (!ok) allPass = false;
    }
    console.log(`\n${allPass ? '✅ Script stage wrote run state AND collected media — safe to render.' : '❌ Something is off — do NOT commit to a full render yet.'}`);

    server.kill('SIGTERM');
    process.exit(allPass ? 0 : 1);
  } catch (e) {
    console.error('FAIL:', e.message);
    server.kill('SIGTERM');
    process.exit(1);
  }
})();
