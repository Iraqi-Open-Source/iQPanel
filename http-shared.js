const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');
const secrets = require('./secrets');
const queue = require('./queue');
const agentClient = require('./agent-client');

const publicRoot = __dirname;
const sessions = new Map();
const loginAttempts = new Map();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function body(request) {
  return new Promise((resolve, reject) => {
    let value = '';
    request.on('data', (chunk) => { value += chunk; if (value.length > 1e6) request.destroy(); });
    request.on('end', () => { try { resolve(value ? JSON.parse(value) : {}); } catch { reject(new Error('Invalid JSON')); } });
    request.on('error', reject);
  });
}

function send(response, status, payload, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(payload));
}

function getSite(slug) { return db.rows(`SELECT * FROM sites WHERE slug=${db.sql(slug)} LIMIT 1`)[0]; }
function log(action, target, details = '') {
  db.run(`INSERT INTO activity_log (id, action, target, details, created_at) VALUES (${db.sql(id())}, ${db.sql(action)}, ${db.sql(target)}, ${db.sql(details)}, ${db.sql(now())})`);
}
function slugify(input) {
  const value = String(input || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 49);
  return value || `site-${Date.now()}`;
}
function publicDatabase(row) {
  if (!row) return row;
  const clone = { ...row };
  delete clone.password_ciphertext;
  delete clone.password;
  return clone;
}

module.exports = {
  body, send, getSite, log, slugify, publicDatabase, sessions, loginAttempts, now, id, publicRoot, crypto, db, secrets, queue, agentClient,
};
