/*
 * Overclocked Rat — emulator shell
 *
 * Wraps EmulatorJS with the bits it doesn't provide out of the box:
 *   - ROM persistence across visits (IndexedDB)
 *   - a plain Normal / 2x speed toggle
 *   - a volume slider that remembers its position
 *   - portable .sav export and import
 *
 * Everything here is client-side. The ROM is read with FileReader and stored
 * only in this browser; nothing is ever uploaded.
 *
 * Driven by data-* attributes on #ocr-emu, so a new system needs no changes here.
 */
(function () {
  "use strict";

  var root = document.getElementById("ocr-emu");
  if (!root) return;

  var CORE = root.dataset.core;
  var SYSTEM = root.dataset.system;
  var DATA_PATH = root.dataset.datapath;

  var DB_NAME = "ocr-emulator";
  var DB_VERSION = 1;
  var STORE = "roms";
  var VOLUME_KEY = "ocr-emu-volume";

  var el = {
    resume: document.getElementById("ocr-resume"),
    resumeName: document.getElementById("ocr-resume-name"),
    resumeBtn: document.getElementById("ocr-resume-btn"),
    resumeOther: document.getElementById("ocr-resume-other"),
    forget: document.getElementById("ocr-forget"),
    picker: document.getElementById("ocr-picker"),
    drop: document.getElementById("ocr-drop"),
    file: document.getElementById("ocr-file"),
    player: document.getElementById("ocr-player"),
    controls: document.getElementById("ocr-controls"),
    volume: document.getElementById("ocr-volume"),
    volumeVal: document.getElementById("ocr-volume-val"),
    speed: document.getElementById("ocr-speed"),
    exportBtn: document.getElementById("ocr-export"),
    importBtn: document.getElementById("ocr-import"),
    importFile: document.getElementById("ocr-import-file"),
    change: document.getElementById("ocr-change"),
    status: document.getElementById("ocr-status")
  };

  var booted = false;

  /* ---------------------------------------------------------------- utils */

  function status(msg, kind) {
    if (!el.status) return;
    el.status.textContent = msg || "";
    el.status.className = "ocr-status" + (kind ? " ocr-status-" + kind : "");
  }

  function show(node) { if (node) node.hidden = false; }
  function hide(node) { if (node) node.hidden = true; }

  function baseName(name) {
    return String(name).replace(/\.[^.]+$/, "");
  }

  function formatSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
    return bytes + " B";
  }

  /* ------------------------------------------------------------ indexeddb */

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbPut(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function dbDelete(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /* Ask the browser not to evict our storage under disk pressure. */
  function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then(function (already) {
        if (!already) navigator.storage.persist();
      }).catch(function () { /* non-fatal */ });
    }
  }

  /* -------------------------------------------------------------- booting */

  function initialVolume() {
    var stored = parseFloat(localStorage.getItem(VOLUME_KEY));
    if (isNaN(stored) || stored < 0 || stored > 1) return 0.5;
    return stored;
  }

  function boot(name, buffer) {
    if (booted) return;
    booted = true;

    hide(el.resume);
    hide(el.picker);
    status("Loading core\u2026");

    var vol = initialVolume();

    window.EJS_player = "#ocr-player";
    window.EJS_core = CORE;
    window.EJS_pathtodata = DATA_PATH;
    window.EJS_gameName = baseName(name);
    window.EJS_gameUrl = URL.createObjectURL(new Blob([buffer]));
    window.EJS_startOnLoaded = true;
    window.EJS_volume = vol;
    window.EJS_defaultOptions = { "save-state-location": "browser" };
    window.EJS_ready = onReady;

    var script = document.createElement("script");
    script.src = DATA_PATH + "loader.js";
    script.onerror = function () {
      status("Could not load the emulator core. Check your connection and reload.", "error");
    };
    document.body.appendChild(script);
  }

  function loadFile(file) {
    if (!file) return;
    status("Reading " + file.name + " (" + formatSize(file.size) + ")\u2026");

    var reader = new FileReader();
    reader.onload = function () {
      var buffer = reader.result;
      requestPersistence();
      dbPut(SYSTEM, {
        name: file.name,
        size: file.size,
        data: buffer,
        savedAt: Date.now()
      }).catch(function (err) {
        // Storing is a convenience, not a requirement — play anyway.
        console.warn("Could not persist ROM:", err);
      }).then(function () {
        boot(file.name, buffer);
      });
    };
    reader.onerror = function () {
      status("Could not read that file.", "error");
    };
    reader.readAsArrayBuffer(file);
  }

  /* ------------------------------------------------------------- controls */

  function emu() { return window.EJS_emulator; }

  function fs() {
    var e = emu();
    if (!e) return null;
    if (e.gameManager && e.gameManager.FS) return e.gameManager.FS;
    if (e.Module && e.Module.FS) return e.Module.FS;
    return null;
  }

  function onReady() {
    status("");
    show(el.controls);

    var vol = initialVolume();
    el.volume.value = Math.round(vol * 100);
    el.volumeVal.textContent = Math.round(vol * 100) + "%";

    el.volume.addEventListener("input", function () {
      var v = parseInt(el.volume.value, 10) / 100;
      el.volumeVal.textContent = el.volume.value + "%";
      localStorage.setItem(VOLUME_KEY, String(v));
      var e = emu();
      if (!e) return;
      e.volume = v;
      if (typeof e.setVolume === "function") e.setVolume(v);
    });

    el.speed.addEventListener("click", function () {
      var e = emu();
      if (!e || typeof e.changeSettingOption !== "function") return;
      var goingFast = el.speed.getAttribute("aria-pressed") !== "true";
      // Route through the emulator's own settings system so its menu stays in sync.
      e.changeSettingOption("ff-ratio", "2.0");
      e.changeSettingOption("fastForward", goingFast ? "enabled" : "disabled");
      el.speed.setAttribute("aria-pressed", goingFast ? "true" : "false");
      el.speed.textContent = goingFast ? "2\u00d7" : "Normal";
      el.speed.classList.toggle("is-active", goingFast);
    });

    el.exportBtn.addEventListener("click", exportSave);
    el.importBtn.addEventListener("click", function () { el.importFile.click(); });
    el.importFile.addEventListener("change", function () {
      importSave(el.importFile.files[0]);
      el.importFile.value = "";
    });

    el.change.addEventListener("click", function () {
      dbDelete(SYSTEM).catch(function () {}).then(function () {
        location.reload();
      });
    });
  }

  function exportSave() {
    var e = emu();
    if (!e || !e.gameManager) {
      status("The emulator isn't running yet.", "error");
      return;
    }

    var data;
    try {
      // getSaveFile() flushes the core's pending writes before reading.
      data = e.gameManager.getSaveFile();
    } catch (err) {
      console.error(err);
      status("Could not read the save file.", "error");
      return;
    }

    if (!data || !data.length) {
      status("No in-game save exists yet \u2014 save inside the game first.", "error");
      return;
    }

    var name = (window.EJS_gameName || SYSTEM) + ".sav";
    var url = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    status("Exported " + name + " (" + formatSize(data.length) + ").", "ok");
  }

  function importSave(file) {
    if (!file) return;
    var e = emu();
    var F = fs();
    if (!e || !e.gameManager || !F) {
      status("The emulator isn't running yet.", "error");
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result);
      var path;
      try {
        path = e.gameManager.getSaveFilePath();
        F.writeFile(path, bytes);
      } catch (err) {
        console.error(err);
        status("Could not write the save file.", "error");
        return;
      }

      status("Save imported \u2014 restarting to apply\u2026", "ok");

      // Push the write through to IndexedDB, then reload so the core picks the
      // save up cleanly on boot. The ROM is already stored, so this is quick.
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        location.reload();
      };
      try {
        F.syncfs(false, finish);
      } catch (err) {
        finish();
        return;
      }
      // Belt and braces: reload even if syncfs never calls back.
      setTimeout(finish, 3000);
    };
    reader.onerror = function () {
      status("Could not read that file.", "error");
    };
    reader.readAsArrayBuffer(file);
  }

  /* ----------------------------------------------------------- page setup */

  function wirePicker() {
    el.drop.addEventListener("click", function () { el.file.click(); });
    el.drop.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        el.file.click();
      }
    });

    el.file.addEventListener("change", function () {
      loadFile(el.file.files[0]);
    });

    ["dragenter", "dragover"].forEach(function (type) {
      el.drop.addEventListener(type, function (ev) {
        ev.preventDefault();
        el.drop.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      el.drop.addEventListener(type, function (ev) {
        ev.preventDefault();
        el.drop.classList.remove("is-over");
      });
    });
    el.drop.addEventListener("drop", function (ev) {
      if (ev.dataTransfer && ev.dataTransfer.files.length) {
        loadFile(ev.dataTransfer.files[0]);
      }
    });
  }

  function start() {
    wirePicker();

    dbGet(SYSTEM).then(function (stored) {
      if (stored && stored.data) {
        el.resumeName.textContent =
          stored.name + " (" + formatSize(stored.size) + ")";
        show(el.resume);

        el.resumeBtn.addEventListener("click", function () {
          boot(stored.name, stored.data);
        });
        el.resumeOther.addEventListener("click", function () {
          hide(el.resume);
          show(el.picker);
        });
        el.forget.addEventListener("click", function () {
          dbDelete(SYSTEM).catch(function () {}).then(function () {
            hide(el.resume);
            show(el.picker);
            status("Stored ROM removed from this browser.", "ok");
          });
        });
      } else {
        show(el.picker);
      }
    }).catch(function (err) {
      console.warn("Storage unavailable:", err);
      show(el.picker);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
