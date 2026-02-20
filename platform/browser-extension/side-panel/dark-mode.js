// Apply dark mode class based on system preference before first paint
(function () {
  var m = window.matchMedia('(prefers-color-scheme:dark)');
  function a(e) {
    document.documentElement.classList.toggle('dark', e.matches);
  }
  a(m);
  m.addEventListener('change', a);
})();
