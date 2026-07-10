#!/usr/bin/env node
// Verify a github-card scene flows through MCP set_strategy → script.json →
// GitHub enrichment → renderable props.
import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(__dirname, '..');
const server = spawn('node', [join(__dirname, 'server.mjs')], {stdio: ['pipe', 'pipe', 'inherit']});
let buf = '';
const pending = new Map();
let id = 0;
function send(method, params) {
  return new Promise((resolve, reject) => {
    const reqId = ++id;
    pending.set(reqId, {resolve, reject});
    server.stdin.write(JSON.stringify({jsonrpc: '2.0', id: reqId, method, params}) + '\n');
    setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); reject(new Error(`timeout: ${method}`)); } }, 180000);
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
const callTool = async (name, args) => JSON.parse((await send('tools/call', {name, arguments: args})).content[0].text);

(async () => {
  try {
    await send('initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'gh-test', version: '0'}});
    server.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');

    const {slug} = await callTool('create_run', {slug: 'gh-mcp-test'});
    console.log('run:', slug);

    await callTool('set_strategy', {
      slug,
      hook: 'This open-source repo quietly powers thousands of apps.',
      voiceover: "This open-source repo quietly powers thousands of apps. It started as a weekend project. Now it renders video in React. The whole thing is on GitHub. Look at the star count. Star it and try it yourself.",
      angle: 'Remotion open-source spotlight',
      autoDuration: true,
      mediaCollection: 'skip',
      scenes: [
        {type: 'hook', onScreen: 'This open-source repo quietly powers thousands of apps.', spoken: 'This open-source repo quietly powers thousands of apps.'},
        {type: 'problem', onScreen: 'Most video tools lock you into a timeline editor.', spoken: 'Most video tools lock you into a timeline editor.'},
        {type: 'statement', onScreen: 'What if you could write video in React?', spoken: 'It started as a weekend project. Now it renders video in React.'},
        {type: 'github-card', onScreen: 'The whole thing is on GitHub.', spoken: 'The whole thing is on GitHub.', layoutData: {url: 'https://github.com/remotion-dev/remotion'}},
        {type: 'stat', onScreen: 'Thousands of stars and counting.', spoken: 'Look at the star count.', layoutData: {value: '21k', label: 'GitHub stars'}},
        {type: 'cta', onScreen: 'Star it and try it yourself.', spoken: 'Star it and try it yourself.'},
      ],
    });

    const scriptPath = join(TOOL_ROOT, 'runs', slug, 'script.json');
    if (!existsSync(scriptPath)) throw new Error('script.json not written');
    const script = JSON.parse(readFileSync(scriptPath, 'utf-8'));
    const ghScene = (script.strategy.scenes || []).find((s) => s.type === 'github-card' || s.layout === 'github-card');
    console.log('github-card scene present:', Boolean(ghScene));
    console.log('enriched layoutData:', JSON.stringify(ghScene?.layoutData || null, null, 2));

    const d = ghScene?.layoutData || {};
    const ok = Boolean(ghScene) && d.owner === 'remotion-dev' && d.repo === 'remotion';
    const enriched = Boolean(d.stars) || Boolean(d.language) || Boolean(d.description);
    console.log('owner/repo resolved:', ok, '| live-enriched (stars/lang/desc):', enriched);
    console.log(ok ? '\n✅ github-card flows through MCP end-to-end' : '\n❌ github-card not wired correctly');
    server.kill('SIGTERM');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('FAIL:', e.message);
    server.kill('SIGTERM');
    process.exit(1);
  }
})();
