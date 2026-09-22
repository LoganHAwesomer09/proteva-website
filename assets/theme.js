(function () {
  try {
    const saved = localStorage.getItem('proteva_theme');
    document.documentElement.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch { document.documentElement.dataset.theme = 'light'; }
})();
