#!/usr/bin/env node
// Minimal MCP client — sends JSON-RPC requests to the MCP server over stdio.
// Usage: node client.mjs <tool-name> '<json-args>'

import {spawn} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, 'server.mjs');

const toolName = process.argv[2];
const rawArgs = process.argv[3] || '{}';

if (!toolName) {
  console.error('Usage: node client.mjs <tool-name> [json-args]');
  process.exit(1);
}

const args = JSON.parse(rawArgs);
let id = 1;

const child = spawn('node', [SERVER], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {...process.env},
});

let buf = '';
const responses = [];

child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      responses.push(msg);
    } catch {}
  }
});

child.stderr.on('data', (chunk) => {
  // MCP server logs go to stderr — ignore unless DEBUG
  if (process.env.DEBUG) process.stderr.write(chunk);
});

// Send initialize
child.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: id++,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {name: 'reel-client', version: '1.0.0'},
  },
}) + '\n');

// Wait for initialize response, then call the tool
setTimeout(() => {
  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: id++,
    method: 'notifications/initialized',
    params: {},
  }) + '\n');

  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: id++,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  }) + '\n');
}, 500);

// Wait for response and exit
const timeout = setTimeout(() => {
  console.error('Timeout waiting for MCP response');
  child.kill();
  process.exit(1);
}, 600_000);

function checkDone() {
  const toolResponse = responses.find(
    (r) => r.result && r.id >= 3
  );
  if (toolResponse) {
    clearTimeout(timeout);
    console.log(JSON.stringify(toolResponse.result, null, 2));
    child.kill();
    process.exit(0);
  }
}

setInterval(checkDone, 200);
