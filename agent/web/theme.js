(() => {
  const key = "okf-chat-theme";
  let saved;
  try {
    const value = localStorage.getItem(key);
    if (value === "light" || value === "dark") saved = value;
  } catch {
    saved = undefined;
  }

  const preference = window.matchMedia("(prefers-color-scheme: dark)");
  const theme = saved ?? (preference.matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.okfTheme = {
    key,
    explicit: saved !== undefined,
    current: theme,
  };
  preference.addEventListener("change", (event) => {
    if (window.okfTheme.explicit) return;
    window.okfTheme.current = event.matches ? "dark" : "light";
    document.documentElement.dataset.theme = window.okfTheme.current;
    document.documentElement.style.colorScheme = window.okfTheme.current;
  });
})();
