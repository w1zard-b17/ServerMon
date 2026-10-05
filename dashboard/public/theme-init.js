// sets the theme before first paint. external file because the CSP blocks inline scripts
(function () {
  try {
    var saved = localStorage.getItem("servermon-theme");
    var theme = saved || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
