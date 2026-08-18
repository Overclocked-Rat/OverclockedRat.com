(function () {
  var STORAGE_KEY = 'ocr_tool_visits';

  function readVisits() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function writeVisits(visits) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visits));
    } catch (e) {
      /* localStorage unavailable (private browsing etc.) — fail silently */
    }
  }

  // Call this from any tool page once it loads, e.g.:
  //   <script src="/assets/js/tool-tracker.js"></script>
  //   <script>OCR_bumpToolVisit('jpg-to-png');</script>
  window.OCR_bumpToolVisit = function (toolId) {
    if (!toolId) return;
    var visits = readVisits();
    visits[toolId] = (visits[toolId] || 0) + 1;
    writeVisits(visits);
  };

  // Personalize the Home dashboard's "Featured tool" box, if present on this page.
  document.addEventListener('DOMContentLoaded', function () {
    var dataEl = document.getElementById('dashboard-tool-data');
    if (!dataEl) return;

    var tools;
    try {
      tools = JSON.parse(dataEl.textContent);
    } catch (e) {
      return;
    }
    if (!tools || !tools.length) return;

    var visits = readVisits();

    var winner = null;
    var winnerCount = 0;
    for (var i = 0; i < tools.length; i++) {
      var count = visits[tools[i].id] || 0;
      if (count > winnerCount) {
        winnerCount = count;
        winner = tools[i];
      }
    }

    // No visits recorded yet (or nothing beats 0) — leave the server-rendered
    // fallback (first tool in the list) exactly as it is.
    if (!winner || winnerCount <= 0) return;

    var box = document.getElementById('dashboard-tool-box');
    var label = document.getElementById('dashboard-tool-label');
    var title = document.getElementById('dashboard-tool-title');
    var description = document.getElementById('dashboard-tool-description');
    var link = box ? box.querySelector('a.post-preview') : null;

    if (label) label.textContent = 'Your most-used tool';
    if (title) title.textContent = winner.name;
    if (description) description.textContent = winner.description;
    if (link && winner.url) link.setAttribute('href', winner.url);
  });
})();
