import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PREFIX = 'iqpanel-';
export const SITES_ROOT = process.env.PANEL_SITES_ROOT ?? '/var/www/sites';

export function siteUserName(slug) {
  if (PREFIX.length + slug.length <= 32) return `${PREFIX}${slug}`;
  const hash = createHash('sha1').update(slug).digest('hex').slice(0, 6);
  const keep = 32 - PREFIX.length - 1 - hash.length;
  return `${PREFIX}${slug.slice(0, keep)}-${hash}`;
}

/** Own the site home (and optional path) as the per-site system user. */
export function chownToSiteUser(slug, path = join(SITES_ROOT, slug)) {
  const user = siteUserName(slug);
  execFileSync('chown', ['-R', `${user}:${user}`, path], { encoding: 'utf8' });
}
