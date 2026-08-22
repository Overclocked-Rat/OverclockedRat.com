/*
 * Overclocked Rat — PDF Split
 *
 * Splits one PDF into a smaller extract or into one file per page, entirely in
 * the browser. Uses pdf-lib to read/write PDF structure, pdf.js to render page
 * thumbnails, and fflate to zip the per-page output (all vendored — see
 * assets/vendor/VENDORED.md).
 *
 * Nothing is uploaded. The file is read with FileReader, thumbnails are
 * rendered to <canvas>, and output is handed back as a Blob download.
 *
 * Design notes:
 *   - One file at a time (unlike Merge). Parsed once on add via pdf-lib to get
 *     the page count and catch password-protected/unreadable files early.
 *   - pdf.js's getDocument() TRANSFERS the ArrayBuffer it's given to its
 *     worker (confirmed against the vendored source: it calls
 *     sendWithPromise(..., [data.buffer])), which detaches it. The original
 *     bytes are kept untouched for pdf-lib; pdf.js always gets a fresh
 *     buffer.slice(0) copy, made fresh for thumbnails.
 *   - Selection is a Set of 1-based page numbers, kept in sync two ways:
 *     clicking a thumbnail toggles it and rewrites the range field as
 *     compressed ascending ranges; typing in the range field (on blur/Enter)
 *     parses it and rewrites the Set and highlights. Extraction always output
 *     pages in ascending document order — no reordering/duplicate support,
 *     since the spec (page ranges like "1-3, 7") doesn't call for it and
 *     duplicate-aware reordering isn't worth the complexity it'd add here.
 *   - "Split into files" ignores the selection and always covers every page —
 *     it's a bulk operation on the whole document, not the extract.
 */
(function () {
  "use strict";

  var root = document.getElementById("pdfs");
  if (!root) return;

  if (typeof OCR_bumpToolVisit === "function") {
    OCR_bumpToolVisit("pdf-split");
  }

  var THUMB_WIDTH = 140;

  var el = {
    drop: document.getElementById("pdfs-drop"),
    file: document.getElementById("pdfs-file"),
    workWrap: document.getElementById("pdfs-work-wrap"),
    fileMeta: document.getElementById("pdfs-file-meta"),
    reset: document.getElementById("pdfs-reset"),
    grid: document.getElementById("pdfs-grid"),
    range: document.getElementById("pdfs-range"),
    selectAll: document.getElementById("pdfs-select-all"),
    selectNone: document.getElementById("pdfs-select-none"),
    extractName: document.getElementById("pdfs-extract-name"),
    extractGo: document.getElementById("pdfs-extract-go"),
    splitGo: document.getElementById("pdfs-split-go"),
    status: document.getElementById("pdfs-status")
  };

  /* The loaded file: { name, size, bytes, pageCount } or null. */
  var doc = null;
  var selected = new Set();
  var busy = false;

  /* ---------------------------------------------------------------- utils */

  function status(msg, kind) {
    el.status.textContent = msg || "";
    el.status.className = "ocr-status" + (kind ? " ocr-status-" + kind : "");
  }

  function formatSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
    return bytes + " B";
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("Could not read the file")); };
      reader.readAsArrayBuffer(file);
    });
  }

  /* Turn a pdf-lib failure into something a human can act on. */
  function describeLoadError(err) {
    var msg = String((err && err.message) || err || "");
    if (/encrypt/i.test(msg)) {
      return "is password-protected";
    }
    if (/Failed to parse|Expected instance|No PDF header|invalid/i.test(msg)) {
      return "isn't a readable PDF";
    }
    return "couldn't be opened";
  }

  /* ------------------------------------------------------- range <-> Set */

  /* Set of 1-based page numbers -> "1-3, 7" (ascending, run-compressed). */
  function setToRangeString(set) {
    var pages = Array.prototype.slice.call(set).sort(function (a, b) { return a - b; });
    var parts = [];
    var i = 0;
    while (i < pages.length) {
      var start = pages[i];
      var end = start;
      while (i + 1 < pages.length && pages[i + 1] === end + 1) {
        end = pages[++i];
      }
      parts.push(start === end ? String(start) : start + "-" + end);
      i++;
    }
    return parts.join(", ");
  }

  /*
   * "1-3, 7" -> { pages: Set{1,2,3,7}, error: null }
   * Invalid token -> { pages: null, error: "human-readable reason" }
   */
  function rangeStringToSet(str, pageCount) {
    var out = new Set();
    var raw = (str || "").trim();
    if (!raw) return { pages: out, error: null };

    var tokens = raw.split(",");
    for (var t = 0; t < tokens.length; t++) {
      var token = tokens[t].trim();
      if (!token) continue;

      var m = token.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        var a = parseInt(m[1], 10);
        var b = parseInt(m[2], 10);
        var lo = Math.min(a, b);
        var hi = Math.max(a, b);
        if (lo < 1 || hi > pageCount) {
          return { pages: null, error: "\"" + token + "\" is outside 1-" + pageCount };
        }
        for (var p = lo; p <= hi; p++) out.add(p);
        continue;
      }

      var single = token.match(/^(\d+)$/);
      if (single) {
        var n = parseInt(single[1], 10);
        if (n < 1 || n > pageCount) {
          return { pages: null, error: "\"" + token + "\" is outside 1-" + pageCount };
        }
        out.add(n);
        continue;
      }

      return { pages: null, error: "can't read \"" + token + "\" — use page numbers and ranges like 1-3, 7" };
    }

    return { pages: out, error: null };
  }

  /* -------------------------------------------------------------- render */

  function syncRangeField() {
    el.range.value = setToRangeString(selected);
  }

  function syncThumbHighlights() {
    var thumbs = el.grid.querySelectorAll(".pdfs-thumb");
    thumbs.forEach(function (thumb) {
      var page = parseInt(thumb.getAttribute("data-page"), 10);
      thumb.classList.toggle("is-selected", selected.has(page));
      thumb.setAttribute("aria-pressed", selected.has(page) ? "true" : "false");
    });
  }

  function updateActionState() {
    var hasSelection = selected.size > 0;
    el.extractGo.disabled = busy || !doc || !hasSelection;
    el.extractGo.title = hasSelection ? "" : "Select at least one page";
    el.splitGo.disabled = busy || !doc;
  }

  /* ----------------------------------------------------------- thumbnails */

  function buildThumbGrid(pageCount) {
    el.grid.innerHTML = "";
    for (var n = 1; n <= pageCount; n++) {
      var fig = document.createElement("button");
      fig.type = "button";
      fig.className = "pdfs-thumb";
      fig.setAttribute("data-page", n);
      fig.setAttribute("aria-pressed", "false");
      fig.setAttribute("aria-label", "Page " + n);

      var canvasWrap = document.createElement("span");
      canvasWrap.className = "pdfs-thumb-canvas-wrap";

      var num = document.createElement("span");
      num.className = "pdfs-thumb-num";
      num.textContent = n;

      fig.appendChild(canvasWrap);
      fig.appendChild(num);
      fig.addEventListener("click", function () {
        var page = parseInt(this.getAttribute("data-page"), 10);
        if (selected.has(page)) selected.delete(page);
        else selected.add(page);
        syncRangeField();
        syncThumbHighlights();
        updateActionState();
      });

      el.grid.appendChild(fig);
    }
  }

  function renderThumbnails(bytes, pageCount) {
    if (!window.pdfjsLib) {
      status("Thumbnails unavailable (PDF renderer didn't load); page selection still works by typing a range.", "error");
      return;
    }

    // Fresh copy — getDocument() transfers/detaches the buffer it's given.
    var loadingTask = window.pdfjsLib.getDocument({ data: bytes.slice(0) });

    loadingTask.promise.then(function (pdfDoc) {
      var chain = Promise.resolve();
      var _loop = function (n) {
        chain = chain.then(function () {
          return renderOneThumb(pdfDoc, n);
        });
      };
      for (var n = 1; n <= pageCount; n++) _loop(n);
      return chain;
    }).catch(function (err) {
      console.error(err);
      status("Couldn't render thumbnails; page selection still works by typing a range.", "error");
    });
  }

  function renderOneThumb(pdfDoc, pageNum) {
    var thumb = el.grid.querySelector('.pdfs-thumb[data-page="' + pageNum + '"]');
    if (!thumb) return Promise.resolve();
    var wrap = thumb.querySelector(".pdfs-thumb-canvas-wrap");

    return pdfDoc.getPage(pageNum).then(function (page) {
      var natural = page.getViewport({ scale: 1 });
      var scale = THUMB_WIDTH / natural.width;
      var viewport = page.getViewport({ scale: scale });

      var canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      var ctx = canvas.getContext("2d");

      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        wrap.innerHTML = "";
        wrap.appendChild(canvas);
      });
    }).catch(function (err) {
      console.error("Thumbnail failed for page " + pageNum, err);
      wrap.textContent = "?";
    });
  }

  /* ------------------------------------------------------------- add file */

  function addFile(file) {
    if (!file) return;

    status("Reading \u2026");

    readAsArrayBuffer(file).then(function (buffer) {
      return PDFLib.PDFDocument.load(buffer).then(function (parsed) {
        doc = {
          name: file.name,
          size: file.size,
          bytes: buffer,
          pageCount: parsed.getPageCount()
        };
        selected = new Set();

        el.fileMeta.textContent = doc.name + " \u00b7 " + plural(doc.pageCount, "page") +
          " \u00b7 " + formatSize(doc.size);
        el.workWrap.hidden = false;
        el.range.value = "";

        buildThumbGrid(doc.pageCount);
        updateActionState();
        status("Loaded. Rendering thumbnails \u2026");
        renderThumbnails(doc.bytes, doc.pageCount);
        status("Ready.", "ok");
      });
    }).catch(function (err) {
      status(file.name + " " + describeLoadError(err) + ".", "error");
    });
  }

  /* ---------------------------------------------------------------- reset */

  function reset() {
    doc = null;
    selected = new Set();
    el.workWrap.hidden = true;
    el.grid.innerHTML = "";
    el.range.value = "";
    updateActionState();
    status("");
  }

  /* -------------------------------------------------------------- extract */

  function extract() {
    if (busy || !doc || !selected.size) return;

    busy = true;
    updateActionState();
    status("Extracting \u2026");

    var indices = Array.prototype.slice.call(selected)
      .sort(function (a, b) { return a - b; })
      .map(function (n) { return n - 1; });

    var out;
    PDFLib.PDFDocument.load(doc.bytes).then(function (src) {
      return PDFLib.PDFDocument.create().then(function (created) {
        out = created;
        return out.copyPages(src, indices);
      });
    }).then(function (pages) {
      pages.forEach(function (page) { out.addPage(page); });
      return out.save();
    }).then(function (bytes) {
      downloadPdf(bytes, (el.extractName.value || "extract").trim());
      status("Extracted " + plural(indices.length, "page") + " (" +
             formatSize(bytes.length) + ").", "ok");
    }).catch(function (err) {
      console.error(err);
      status("Extraction failed: " + describeLoadError(err) + ".", "error");
    }).then(function () {
      busy = false;
      updateActionState();
    });
  }

  /* ---------------------------------------------------------- split-all */

  function splitAll() {
    if (busy || !doc) return;

    busy = true;
    updateActionState();
    status("Splitting " + plural(doc.pageCount, "page") + " \u2026");

    var width = String(doc.pageCount).length;
    var files = {};

    PDFLib.PDFDocument.load(doc.bytes).then(function (src) {
      var chain = Promise.resolve();
      var _loop = function (i) {
        chain = chain.then(function () {
          return PDFLib.PDFDocument.create().then(function (created) {
            return created.copyPages(src, [i]).then(function (pages) {
              created.addPage(pages[0]);
              return created.save();
            }).then(function (bytes) {
              var label = String(i + 1);
              while (label.length < width) label = "0" + label;
              files["page-" + label + ".pdf"] = bytes;
            });
          });
        });
      };
      for (var i = 0; i < doc.pageCount; i++) _loop(i);
      return chain;
    }).then(function () {
      var zipped = fflate.zipSync(files, { level: 0 }); // already-compressed PDF bytes
      downloadZip(zipped, (el.extractName.value || doc.name.replace(/\.pdf$/i, "")).trim() + "-pages");
      status("Split into " + plural(doc.pageCount, "file") + " (" +
             formatSize(zipped.length) + " zip).", "ok");
    }).catch(function (err) {
      console.error(err);
      status("Split failed: " + describeLoadError(err) + ".", "error");
    }).then(function () {
      busy = false;
      updateActionState();
    });
  }

  /* -------------------------------------------------------------- output */

  function sanitizeName(name, fallback) {
    var cleaned = (name || "").trim().replace(/\.pdf$/i, "").replace(/[\/\\:*?"<>|]/g, "-");
    return cleaned || fallback;
  }

  function downloadPdf(bytes, name) {
    var filename = sanitizeName(name, "extract") + ".pdf";
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), filename);
  }

  function downloadZip(bytes, name) {
    var filename = sanitizeName(name, "pages") + ".zip";
    downloadBlob(new Blob([bytes], { type: "application/zip" }), filename);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ----------------------------------------------------------- page setup */

  el.drop.addEventListener("click", function () { el.file.click(); });
  el.drop.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      el.file.click();
    }
  });

  el.file.addEventListener("change", function () {
    if (el.file.files && el.file.files[0]) addFile(el.file.files[0]);
    el.file.value = "";
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
      addFile(ev.dataTransfer.files[0]);
    }
  });

  el.reset.addEventListener("click", reset);

  el.selectAll.addEventListener("click", function () {
    if (!doc) return;
    selected = new Set();
    for (var n = 1; n <= doc.pageCount; n++) selected.add(n);
    syncRangeField();
    syncThumbHighlights();
    updateActionState();
  });

  el.selectNone.addEventListener("click", function () {
    selected = new Set();
    syncRangeField();
    syncThumbHighlights();
    updateActionState();
  });

  function applyRangeField() {
    if (!doc) return;
    var result = rangeStringToSet(el.range.value, doc.pageCount);
    if (result.error) {
      status(result.error, "error");
      return;
    }
    selected = result.pages;
    syncThumbHighlights();
    updateActionState();
    status("");
  }

  el.range.addEventListener("blur", applyRangeField);
  el.range.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      applyRangeField();
    }
  });

  el.extractGo.addEventListener("click", extract);
  el.splitGo.addEventListener("click", splitAll);

  updateActionState();
})();
