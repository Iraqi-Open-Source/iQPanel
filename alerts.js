const crypto = require('node:crypto');
const db = require('./db');
const secrets = require('./secrets');
const metrics = require('./metrics');

const now = () => new Date().toISOString();
const setting = (key) => db.rows(`SELECT value FROM settings WHERE key=${db.sql(key)}`)[0]?.value || '';

function thresholds() {
  return {
    cpu: Number(setting('alert_cpu_threshold') || 90),
    memory: Number(setting('alert_memory_threshold') || 90),
    disk: Number(setting('alert_disk_threshold') || 90),
  };
}

function breached(snapshot, limits = thresholds()) {
  return Object.entries(limits)
    .filter(([metric, threshold]) => Number(snapshot[metric]) >= threshold)
    .map(([metric, threshold]) => ({ metric, value: Number(snapshot[metric]), threshold }));
}

function recentlyDelivered(channel, metric, cooldownMinutes = 60) {
  const cutoff = new Date(Date.now() - cooldownMinutes * 60000).toISOString();
  return db.rows(`SELECT id FROM alert_events WHERE channel=${db.sql(channel)} AND metric=${db.sql(metric)} AND status='sent' AND created_at >= ${db.sql(cutoff)} LIMIT 1`).length > 0;
}

async function deliverDiscord(message, webhook) {
  if (!webhook) return false;
  const response = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: message }) });
  if (!response.ok) throw new Error(`Discord returned ${response.status}`);
  return true;
}

async function deliverTelegram(message, token, chatId) {
  if (!token || !chatId) return false;
  const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: message }) });
  if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
  return true;
}

async function dispatch(snapshot, options = {}) {
  const events = breached(snapshot, options.limits || thresholds());
  const cooldown = Number(options.cooldownMinutes || setting('alert_cooldown_minutes') || 60);
  const channels = [];
  const discordCipher = setting('discord_webhook');
  if (discordCipher) channels.push(['discord', (message) => deliverDiscord(message, secrets.decrypt(discordCipher))]);
  const telegramCipher = setting('telegram_bot_token');
  if (telegramCipher && setting('telegram_chat_id')) channels.push(['telegram', (message) => deliverTelegram(message, secrets.decrypt(telegramCipher), setting('telegram_chat_id'))]);
  const created = [];
  for (const event of events) {
    const message = `iQPanel alert: ${event.metric} is ${event.value}% (threshold ${event.threshold}%)`;
    for (const [channel, send] of channels) {
      if (recentlyDelivered(channel, event.metric, cooldown)) continue;
      const id = crypto.randomUUID();
      db.run(`INSERT INTO alert_events (id,channel,metric,value,threshold,status,created_at) VALUES (${db.sql(id)},${db.sql(channel)},${db.sql(event.metric)},${event.value},${event.threshold},'queued',${db.sql(now())})`);
      try {
        await send(message);
        db.run(`UPDATE alert_events SET status='sent' WHERE id=${db.sql(id)}`);
      } catch (error) {
        db.run(`UPDATE alert_events SET status=${db.sql(`failed: ${error.message}`)} WHERE id=${db.sql(id)}`);
      }
      created.push({ ...event, channel });
    }
  }
  return created;
}

async function poll() {
  try { return await dispatch(metrics.snapshot()); } catch { return []; }
}

function start(intervalMs = 60000) {
  poll();
  return setInterval(() => { poll(); }, intervalMs);
}

module.exports = { thresholds, breached, dispatch, poll, start };
