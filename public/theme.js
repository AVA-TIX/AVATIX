/* Apply the saved preference before styles load to avoid flashing the wrong theme. */
(() => {
  const storageKey = 'avatix-theme';
  const valid = value => value === 'light' || value === 'dark';
  const savedTheme = () => {
    try { const value = localStorage.getItem(storageKey); return valid(value) ? value : 'dark'; }
    catch { return 'dark'; }
  };
  const current = () => document.documentElement.dataset.theme || 'dark';
  function sync() {
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === current()));
    });
  }
  function set(value, persist = true) {
    if (!valid(value)) return;
    document.documentElement.dataset.theme = value;
    if (persist) { try { localStorage.setItem(storageKey, value); } catch { /* The selection still works without storage. */ } }
    sync();
  }
  window.avatixTheme = {
    set, sync, current,
    controls: () => `<fieldset class="theme-switcher"><legend>Giao diện</legend><div class="theme-options"><button type="button" data-theme-choice="light" aria-pressed="${current() === 'light'}">Sáng</button><button type="button" data-theme-choice="dark" aria-pressed="${current() === 'dark'}">Tối</button></div></fieldset>`
  };
  set(savedTheme(), false);
  document.addEventListener('DOMContentLoaded', sync);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-theme-choice]');
    if (button) set(button.dataset.themeChoice);
  });
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) set(savedTheme(), false);
  });
})();
