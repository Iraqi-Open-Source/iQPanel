const fs = require('node:fs');
const path = require('node:path');

const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024;

function splitTelegramChunks(filePath, maxBytes = TELEGRAM_MAX_BYTES) {
  const size = fs.statSync(filePath).size;
  if (size <= maxBytes) return [filePath];
  const chunks = [];
  const handle = fs.openSync(filePath, 'r');
  try {
    let offset = 0;
    let index = 1;
    while (offset < size) {
      const length = Math.min(maxBytes, size - offset);
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, offset);
      const chunkPath = `${filePath}.part${index}`;
      fs.writeFileSync(chunkPath, buffer);
      chunks.push(chunkPath);
      offset += length;
      index += 1;
    }
  } finally {
    fs.closeSync(handle);
  }
  return chunks;
}

function ftpUploadUrl({ host, user, remotePath }) {
  const cleanHost = String(host || '').replace(/^ftp:\/\//, '');
  const cleanPath = String(remotePath || '').startsWith('/') ? remotePath : `/${remotePath}`;
  return `ftp://${user}:***@${cleanHost}${cleanPath}`;
}

function ftpUploadTarget({ host, user, password, remotePath }) {
  const cleanHost = String(host || '').replace(/^ftp:\/\//, '');
  const cleanPath = String(remotePath || '').startsWith('/') ? remotePath : `/${remotePath}`;
  const encodedUser = encodeURIComponent(String(user || ''));
  const encodedPass = encodeURIComponent(String(password || ''));
  return `ftp://${encodedUser}:${encodedPass}@${cleanHost}${cleanPath}`;
}

function telegramCaption(name, part, total) {
  return `${name} part ${part}/${total}`;
}

async function uploadFtp(filePath, config, command) {
  const remotePath = path.posix.join(config.remote_dir || '/backups', path.basename(filePath));
  const target = ftpUploadTarget({
    host: config.host,
    user: config.user,
    password: config.password,
    remotePath,
  });
  await command('curl', ['--silent', '--show-error', '--ftp-create-dirs', '-T', filePath, target]);
  return { destination: 'ftp', url: ftpUploadUrl({ host: config.host, user: config.user, remotePath }) };
}

async function uploadTelegram(filePath, config, fetchImpl = fetch) {
  const token = String(config.bot_token || '');
  const chatId = String(config.chat_id || '');
  if (!token || !chatId) throw new Error('Telegram destination is not configured');
  const chunks = splitTelegramChunks(filePath);
  const name = path.basename(filePath);
  for (let index = 0; index < chunks.length; index += 1) {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', telegramCaption(name, index + 1, chunks.length));
    form.set('document', new Blob([fs.readFileSync(chunks[index])]), path.basename(chunks[index]));
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`Telegram upload failed (${response.status})`);
  }
  return { destination: 'telegram', parts: chunks.length };
}

module.exports = {
  TELEGRAM_MAX_BYTES,
  splitTelegramChunks,
  ftpUploadUrl,
  ftpUploadTarget,
  telegramCaption,
  uploadFtp,
  uploadTelegram,
};
