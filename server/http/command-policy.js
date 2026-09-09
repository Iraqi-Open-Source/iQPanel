/**
 * Allowlisted site shortcuts vs. commands that need a fresh password.
 */
export const SHORTCUT_ALLOWLIST = new Set([
  'php artisan migrate',
  'php artisan migrate:status',
  'php artisan migrate:fresh',
  'php artisan migrate:rollback',
  'php artisan optimize:clear',
  'php artisan config:cache',
  'php artisan config:clear',
  'php artisan route:cache',
  'php artisan route:clear',
  'php artisan view:cache',
  'php artisan view:clear',
  'php artisan cache:clear',
  'php artisan storage:link',
  'php artisan queue:restart',
  'php artisan queue:flush',
  'php artisan up',
  'php artisan down',
  'php artisan key:generate',
  'php artisan optimize',
  'composer install',
  'composer install --no-dev --optimize-autoloader --no-interaction',
  'composer update --no-dev --optimize-autoloader --no-interaction',
  'npm run build',
  'npm ci',
  'npm install',
]);

export const DESTRUCTIVE_COMMANDS = new Set([
  'php artisan migrate:fresh',
  'php artisan migrate:rollback',
]);

export function normalizeCmd(cmd) {
  return String(cmd ?? '').trim();
}

/** Arbitrary shell and destructive shortcuts require a fresh password; allowlisted artisan/composer do not. */
export function commandNeedsReauth(cmd) {
  const normalized = normalizeCmd(cmd);
  if (DESTRUCTIVE_COMMANDS.has(normalized)) return true;
  if (SHORTCUT_ALLOWLIST.has(normalized)) return false;
  return true;
}
