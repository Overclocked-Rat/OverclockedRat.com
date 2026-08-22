/*
 * Overclocked Rat — PDF Merge
 *
 * Combines multiple PDFs into one, entirely in the browser using pdf-lib
 * (vendored at assets/vendor/pdf-lib/ — see assets/vendor/VENDORED.md).
 *
 * Nothing is uploaded. Files are read with FileReader, merged in memory, and
 * handed back as a Blob download.
 *
 * Design notes:
 *   - Each file is parsed once when added, to validate it and get a page count
 *     early. The bytes are kept and re-parsed at merge time rather than holding
 *     a live PDFDocument per file, which keeps memory predictable when someone
 *     queues up a lot of large documents.
 *   - Reordering uses buttons rather than HTML5 drag-and-drop. Drag is nicer on
 *     desktop but unreliable on touch, and buttons are keyboard-accessible for
 *     free.
 */
(function () {
  "use strict";

  var root = document.getElementById("pdfm");
  if (!root) return;

  if (typeof OCR_bumpToolVisit === "function") {
    OCR_bumpToolVisit("pdf-merge");
  }

  var el = {
    drop: document.getElementById("pdfm-drop"),
    file: document.getElementById("pdfm-file"),
    listWrap: document.getElementById("pdfm-list-wrap"),
    list: document.getElementById("pdfm-list"),
    summary: document.getElementById("pdfm-summary"),
    clear: document.getElementById("pdfm-clear"),
    name: document.getElementById("pdfm-name"),
    go: document.getElementById("pdfm-go"),
    status: document.getElementById("pdfm-status")
  };

  /* Each item: { id, name, size, pages, bytes } */
  var items = [];
  var nextId = 1;
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

  /* ---------------------------------------------------------------- render */

  function render() {
    el.list.innerHTML = "";

    items.forEach(function (item, index) {
      var li = document.createElement("li");
      li.className = "pdfm-item";

      var info = document.createElement("div");
      info.className = "pdfm-item-info";

      var name = document.createElement("span");
      name.className = "pdfm-item-name";
      name.textContent = item.name;

      var meta = document.createElement("span");
      meta.className = "pdfm-item-meta";
      meta.textContent = plural(item.pages, "page") + " · " + formatSize(item.size);

      info.appendChild(name);
      info.appendChild(meta);

      var controls = document.createElement("div");
      controls.className = "pdfm-item-controls";

      controls.appendChild(makeBtn("\u2191", "Move up", index === 0, function () {
        move(index, index - 1);
      }));
      controls.appendChild(makeBtn("\u2193", "Move down", index === items.length - 1, function () {
        move(index, index + 1);
      }));
      controls.appendChild(makeBtn("\u00d7", "Remove", false, function () {
        items.splice(index, 1);
        render();
      }, "pdfm-item-remove"));

      li.appendChild(info);
      li.appendChild(controls);
      el.list.appendChild(li);
    });

    var totalPages = items.reduce(function (n, i) { return n + i.pages; }, 0);
    var totalSize = items.reduce(function (n, i) { return n + i.size; }, 0);

    el.summary.textContent = items.length
      ? plural(items.length, "file") + " · " + plural(totalPages, "page") +
        " · " + formatSize(totalSize)
      : "";

    el.listWrap.hidden = items.length === 0;
    el.go.disabled = busy || items.length < 2;
    el.go.title = items.length < 2 ? "Add at least two PDFs to merge" : "";
  }

  function makeBtn(label, title, disabled, onClick, extraClass) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pdfm-mini-btn" + (extraClass ? " " + extraClass : "");
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = !!disabled || busy;
    b.addEventListener("click", onClick);
    return b;
  }

  function move(from, to) {
    if (to < 0 || to >= items.length) return;
    var moved = items.splice(from, 1)[0];
    items.splice(to, 0, moved);
    render();
  }

  /* ------------------------------------------------------------- add files */

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    status("Reading " + plural(files.length, "file") + "\u2026");

    var added = 0;
    var problems = [];

    var chain = files.reduce(function (p, file) {
      return p.then(function () {
        return readAsArrayBuffer(file).then(function (buffer) {
          // Parse once now so bad files are caught at add time, not merge time.
          return PDFLib.PDFDocument.load(buffer).then(function (doc) {
            items.push({
              id: nextId++,
              name: file.name,
              size: file.size,
              pages: doc.getPageCount(),
              bytes: buffer
            });
            added++;
          });
        }).catch(function (err) {
          problems.push(file.name + " " + describeLoadError(err));
        });
      });
    }, Promise.resolve());

    chain.then(function () {
      render();
      if (problems.length && added) {
        status("Added " + plural(added, "file") + ". Skipped: " +
               problems.join("; ") + ".", "error");
      } else if (problems.length) {
        status("Skipped: " + problems.join("; ") + ".", "error");
      } else {
        status("Added " + plural(added, "file") + ".", "ok");
      }
    });
  }

  /* ---------------------------------------------------------------- merge */

  function merge() {
    if (busy || items.length < 2) return;

    busy = true;
    render();
    status("Merging \u2026");

    var out;

    PDFLib.PDFDocument.create().then(function (merged) {
      out = merged;
      return items.reduce(function (p, item) {
        return p.then(function () {
          return PDFLib.PDFDocument.load(item.bytes).then(function (src) {
            return out.copyPages(src, src.getPageIndices());
          }).then(function (pages) {
            pages.forEach(function (page) { out.addPage(page); });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      return out.save();
    }).then(function (bytes) {
      download(bytes);
      status("Merged " + plural(items.length, "file") + " into " +
             plural(out.getPageCount(), "page") + " (" +
             formatSize(bytes.length) + ").", "ok");
    }).catch(function (err) {
      console.error(err);
      status("Merge failed: " + describeLoadError(err) + ".", "error");
    }).then(function () {
      busy = false;
      render();
    });
  }

  function download(bytes) {
    var name = (el.name.value || "merged").trim().replace(/\.pdf$/i, "");
    if (!name) name = "merged";
    // Strip characters that are awkward in filenames across platforms.
    name = name.replace(/[\/\\:*?"<>|]/g, "-");

    var url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = name + ".pdf";
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
    addFiles(el.file.files);
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
      addFiles(ev.dataTransfer.files);
    }
  });

  el.clear.addEventListener("click", function () {
    items = [];
    render();
    status("");
  });

  el.go.addEventListener("click", merge);

  render();
})();
