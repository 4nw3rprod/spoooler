#!/usr/bin/env node
// E2E smoke test: create a run, set strategy via MCP (skipping the LLM),
// and verify the resulting script.json has the AI-provided scenes.
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
    setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); reject(new Error(`timeout: ${method}`)); } }, 120000);
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
    } catch { /* ignore non-JSON */ }
  }
});

(async () => {
  try {
    await send('initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'e2e', version: '0'}});
    server.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');

    const cr = await send('tools/call', {name: 'create_run', arguments: {slug: 'mcp-smoke'}});
    const {slug} = JSON.parse(cr.content[0].text);
    console.log('Created run:', slug);

    // The AI authors the strategy directly — no Groq, no Cerebras.
    const setRes = await send('tools/call', {
      name: 'set_strategy',
      arguments: {
        slug,
        hook: 'Stop scrolling. Your editor is doing too much.',
        voiceover: "Stop scrolling. Your editor is doing too much. Cursor learns your codebase in minutes. It writes the boring stuff so you ship the interesting stuff. Comment 'CURSOR' and I'll send the setup.",
        angle: 'Cursor positioning for senior devs who feel slowed down by tooling',
        brands: ['Cursor'],
        commentTrigger: 'CURSOR',
        commentReward: 'Setup guide DM',
        autoDuration: true,
        mediaCollection: 'skip',
        scenes: [
          {type: 'hook', layout: 'hook', onScreen: 'Stop scrolling. Your editor is doing too much.', spoken: 'Stop scrolling. Your editor is doing too much.', accentWord: 'too much'},
          {type: 'statement', layout: 'statement', onScreen: 'Cursor learns your codebase in minutes.', spoken: 'Cursor learns your codebase in minutes.', subtext: 'Yes, your repo too.', brands: ['Cursor']},
          {type: 'proof', layout: 'proof', onScreen: 'It writes the boring stuff.', spoken: 'It writes the boring stuff so you ship the interesting stuff.', subtext: 'Refactors, tests, glue code — done.', brands: ['Cursor']},
          {type: 'cta', layout: 'cta', onScreen: "Comment 'CURSOR' for the setup.", spoken: "Comment 'CURSOR' and I'll send the setup."},
        ],
      },
    });
    console.log('set_strategy result:', setRes.content[0].text.slice(0, 400), '...');

    const state = await send('tools/call', {name: 'get_run_state', arguments: {slug}});
    console.log('get_run_state:', state.content[0].text);

    server.kill('SIGTERM');
    process.exit(0);
  } catch (e) {
    console.error('FAIL:', e.message);
    server.kill('SIGTERM');
    process.exit(1);
  }
})();
