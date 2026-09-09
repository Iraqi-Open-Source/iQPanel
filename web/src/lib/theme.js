export const THEME_KEY = 'iqpanel-theme';
export const THEMES = ['light', 'dark', 'system'];

export function getStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (THEMES.includes(value)) return value;
  } catch {}
  return 'system';
}

export function prefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveDark(theme) {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return prefersDark();
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', resolveDark(theme));
}

export function setStoredTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  applyTheme(theme);
}

export function nextTheme(theme) {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

export function watchSystemTheme(theme, onChange) {
  if (theme !== 'system') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    applyTheme('system');
    onChange?.();
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
