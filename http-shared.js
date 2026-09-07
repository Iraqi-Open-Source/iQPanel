const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const db = require('./db');
const secrets = require('./secrets');
const queue = require('./queue');
const agentClient = require('./agent-client');

const publicRoot = __dirname;
const sessions = new Map();
const loginAttempts = new Map();
const requestContext = new AsyncLocalStorage();
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

function rawBody(request, limit = 5e6) {
  return new Promise((resolve, reject) => {
    let value = '';
    request.on('data', (chunk) => { value += chunk; if (value.length > limit) request.destroy(); });
    request.on('end', () => resolve(value));
    request.on('error', reject);
  });
}

function send(response, status, payload, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(payload));
}

function getSite(slug) { return db.rows(`SELECT * FROM sites WHERE slug=${db.sql(slug)} LIMIT 1`)[0]; }
function currentUser() { return requestContext.getStore()?.user || null; }
function currentSession() { return requestContext.getStore()?.session || null; }
function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = status;
  error.payload = { error: message, ...extra };
  throw error;
}
function log(action, target, details = '', actorId = currentUser()?.id) {
  db.run(`INSERT INTO activity_log (id, action, target, details, user_id, created_at) VALUES (${db.sql(id())}, ${db.sql(action)}, ${db.sql(target)}, ${db.sql(details)}, ${db.sql(actorId || null)}, ${db.sql(now())})`);
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

function siteAgent(site) {
  return agentClient.forServer(site?.server_id || 'local');
}

module.exports = {
  body, rawBody, send, getSite, log, slugify, publicDatabase, siteAgent, sessions, loginAttempts, now, id, publicRoot, crypto, db, secrets, queue, agentClient,
  requestContext, currentUser, currentSession, httpError,
};
