/** Units the agent will accept for start/stop/restart. */
export const ACTIONABLE_UNIT = /^(nginx|apache2|httpd|mysql|mariadb|postgresql|redis-server|redis|docker|ufw|ssh|sshd|fail2ban|iqpanel|php\d+\.\d+-fpm|panel-[a-z0-9-]+-[a-z]+)\.service$|^postgresql@.+\.service$/;

const IMPORTANT_RULES = [
  { re: /^nginx\.service$/,                    label: () => 'Nginx' },
  { re: /^(apache2|httpd)\.service$/,         label: () => 'Apache' },
  { re: /^php([\d.]+)-fpm\.service$/,         label: (_, m) => `PHP ${m[1]}-FPM` },
  { re: /^(mysql|mysqld)\.service$/,          label: () => 'MySQL' },
  { re: /^mariadb\.service$/,                 label: () => 'MariaDB' },
  { re: /^postgresql(\.service|@.+\.service)$/, label: () => 'PostgreSQL' },
  { re: /^redis(-server)?\.service$/,          label: () => 'Redis' },
  { re: /^docker\.service$/,                   label: () => 'Docker' },
  { re: /^ufw\.service$/,                      label: () => 'UFW' },
  { re: /^(ssh|sshd)\.service$/,               label: () => 'SSH' },
  { re: /^fail2ban\.service$/,                 label: () => 'Fail2ban' },
  { re: /^iqpanel\.service$/,                  label: () => 'iQPanel' },
];

export function unitName(s) {
  return String(s?.unit ?? s?.name ?? s?.Id ?? '');
}

export function unitActive(s) {
  return String(s?.active ?? s?.ActiveState ?? 'unknown');
}

export function unitDescription(s) {
  return String(s?.description ?? s?.Description ?? '');
}

export function isUnitActive(s) {
  return unitActive(s) === 'active';
}

export function isActionable(unit) {
  return ACTIONABLE_UNIT.test(unit);
}

export function statusVariant(active) {
  if (active === 'active') return 'success';
  if (active === 'failed') return 'destructive';
  if (active === 'activating' || active === 'deactivating') return 'warning';
  return 'secondary';
}

export function pickImportant(services) {
  const out = [];
  const seenUnits = new Set();
  const seenLabels = new Set();
  for (const rule of IMPORTANT_RULES) {
    for (const s of services) {
      const unit = unitName(s);
      if (!unit || seenUnits.has(unit)) continue;
      const m = unit.match(rule.re);
      if (!m) continue;
      const label = rule.label(unit, m);
      // ssh/sshd alias: keep the first match only
      if (seenLabels.has(label) && !label.includes('PHP')) continue;
      seenUnits.add(unit);
      seenLabels.add(label);
      out.push({ ...s, unit, label, active: unitActive(s), description: unitDescription(s) });
    }
  }
  return out;
}

export function filterServices(services, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return services;
  return services.filter((s) => {
    const hay = `${unitName(s)} ${unitDescription(s)} ${unitActive(s)} ${s.sub ?? ''}`.toLowerCase();
    return hay.includes(q);
  });
}
