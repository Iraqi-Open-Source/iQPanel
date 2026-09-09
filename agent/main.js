#!/usr/bin/env node
/**
 * iQPanel root agent.
 * Must run as root. Listens on a Unix socket (0660 root:panel).
 */
import { readFileSync } from 'node:fs';
import { startAgent } from './protocol.js';

const ENV_FILE = process.env.PANEL_ENV_FILE ?? '/etc/panel-agent/env';

function loadEnv(path) {
  try {
    const lines = readFileSync(path, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // env file is optional when running in development
  }
}

loadEnv(ENV_FILE);

const SOCKET  = process.env.PANEL_AGENT_SOCKET ?? '/run/iqpanel-agent.sock';
const TOKEN   = process.env.PANEL_AGENT_TOKEN;

if (!TOKEN) {
  console.error('[agent] PANEL_AGENT_TOKEN is not set. Refusing to start.');
  process.exit(1);
}

startAgent({
  socketPath: SOCKET,
  token: TOKEN,
  onReady() {
    console.log(`[agent] listening on ${SOCKET}`);
  },
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
