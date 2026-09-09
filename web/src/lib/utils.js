import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

export function timeAgo(iso) {
  const ms  = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60)   return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)   return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr < 24)    return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function sitePublicUrl(site) {
  if (!site) return null;
  const domain = String(site.domain ?? '').trim();
  if (domain) {
    if (/^https?:\/\//i.test(domain)) return domain;
    const protocol = site.ssl_status === 'active' ? 'https' : 'http';
    return `${protocol}://${domain}`;
  }
  if (site.port) {
    const host = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
    return `http://${host}:${site.port}`;
  }
  return null;
}

export function statusColor(status) {
  return {
    online:       'text-green-500',
    active:       'text-green-500',
    running:      'text-green-500',
    success:      'text-green-500',
    offline:      'text-red-500',
    failed:       'text-red-500',
    error:        'text-red-500',
    provisioning: 'text-yellow-500',
    queued:       'text-yellow-500',
    stopped:      'text-gray-400',
    none:         'text-gray-400',
  }[status] ?? 'text-gray-400';
}
