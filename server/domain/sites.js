import { createHash } from 'node:crypto';

const PREFIX = 'iqpanel-';

export function siteUserName(slug) {
  if (PREFIX.length + slug.length <= 32) return `${PREFIX}${slug}`;
  const hash = createHash('sha1').update(slug).digest('hex').slice(0, 6);
  const keep = 32 - PREFIX.length - 1 - hash.length;
  return `${PREFIX}${slug.slice(0, keep)}-${hash}`;
}
