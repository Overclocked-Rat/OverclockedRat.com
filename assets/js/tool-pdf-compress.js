/*
 * Overclocked Rat — PDF Compress
 *
 * Shrinks a PDF by re-encoding its embedded JPEG images at a lower quality
 * and/or resolution, entirely in the browser. Uses pdf-lib's low-level object
 * model directly (not its high-level page API) to find and replace image
 * streams in place, and the browser's own JPEG decoder/encoder (<img> +
 * <canvas>) to do the actual recompression.
 *
 * Nothing is uploaded. The file is read with FileReader, mutated in memory,
 * and handed back as a Blob download.
 *
 * Design notes — read before touching the detection/skip logic:
 *   - Only /DCTDecode (JPEG) image XObjects are touched. This was checked
 *     against the vendored pdf-lib source, not assumed: for a DCTDecode
 *     stream, PDFRawStream's contents are the JPEG bytes exactly as they
 *     appear in the file (SOI marker 0xFFD8 present) — no pdf-lib-side
 *     decoding needed, and the browser's own decoder can read them directly.
 *     FlateDecode raw bitmaps, CCITTFaxDecode/JBIG2Decode (fax-style scans)
 *     and JPXDecode (JPEG2000) are skipped with a specific reason rather than
 *     guessed at — those need real format-specific decoders this project
 *     doesn't have vendored.
 *   - Images with /SMask or /Mask (soft masks / transparency) are skipped.
 *     Recompressing would leave the mask's dimensions and the image's
 *     dimensions out of sync in a way that's easy to get subtly wrong, and
 *     transparency is rare in scanned documents, which are the main target
 *     here.
 *   - ColorSpace must resolve to DeviceGray or DeviceRGB (including via an
 *     indirect ICCBased stream with /N of 1 or 3) before it's touched.
 *     DeviceCMYK, Indexed, Separation and anything else is skipped — canvas
 *     is always RGB, so round-tripping a CMYK JPEG through it would shift
 *     colors, and that's worse than leaving the image alone.
 *   - If recompressing an image doesn't actually make it smaller (can happen
 *     at high quality settings on already-efficient JPEGs), the original
 *     bytes are kept rather than swapping in a same-size-or-larger result.
 *   - Images are processed one at a time via a promise chain, matching
 *     Merge's file-at-a-time approach — keeps memory predictable on large,
 *     image-heavy documents rather than decoding everything at once.
 *   - The mutation itself (context.assign() with a cloned dict carrying
 *     updated Width/Height/Length) was tested end-to-end against a real
 *     generated PDF with an embedded photo before this was written, not
 *     just read from docs.
 */
(function () {
  "use strict";

  var root = document.getElementById("pdfc");
  if (!root) return;

  if (typeof OCR_bumpToolVisit === "function") {
    OCR_bumpToolVisit("pdf-compress");
  }

  var el = {
    drop: document.getElementById("pdfc-drop"),
    file: document.getElementById("pdfc-file"),
    workWrap: document.getElementById("pdfc-work-wrap"),
    fileMeta: document.getElementById("pdfc-file-meta"),
    reset: document.getElementById("pdfc-reset"),
    quality: document.getElementById("pdfc-quality"),
    qualityVal: document.getElementById("pdfc-quality-val"),
    maxDim: document.getElementById("pdfc-maxdim"),
    name: document.getElementById("pdfc-name"),
    go: document.getElementById("pdfc-go"),
    status: document.getElementById("pdfc-status")
  };

  /* The loaded file: { name, size, bytes } or null. */
  var doc = null;
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

  /* -------------------------------------------------------- image decode */

  /* JPEG bytes -> <img>, via Blob + object URL rather than createImageBitmap,
   * for the same broad-browser-support reasoning the vendored pdf.js build
   * was chosen with. */
  function decodeJpeg(bytes) {
    return new Promise(function (resolve, reject) {
      var blob = new Blob([bytes], { type: "image/jpeg" });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("couldn't decode"));
      };
      img.src = url;
    });
  }

  function canvasToJpeg(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error("canvas encode failed")); return; }
        var reader = new FileReader();
        reader.onload = function () { resolve(new Uint8Array(reader.result)); };
        reader.onerror = function () { reject(new Error("couldn't read encoded blob")); };
        reader.readAsArrayBuffer(blob);
      }, "image/jpeg", quality);
    });
  }

  /* -------------------------------------------------------- classification */

  /*
   * Decide whether an image XObject's dict is safe to recompress.
   * Returns { ok: true } or { ok: false, reason: "human-readable reason" }.
   */
  function classifyImage(dict, context) {
    if (dict.has(PDFLib.PDFName.of("SMask")) || dict.has(PDFLib.PDFName.of("Mask"))) {
      return { ok: false, reason: "has transparency" };
    }

    var filter = dict.get(PDFLib.PDFName.of("Filter"));
    if (!(filter instanceof PDFLib.PDFName) || filter.toString() !== "/DCTDecode") {
      var filterName = filter ? filter.toString() : "no filter";
      return { ok: false, reason: "isn't JPEG-encoded (" + filterName + ")" };
    }

    var cs = dict.get(PDFLib.PDFName.of("ColorSpace"));

    if (cs instanceof PDFLib.PDFName) {
      var name = cs.toString();
      if (name === "/DeviceRGB" || name === "/DeviceGray") {
        return { ok: true };
      }
      return { ok: false, reason: name + " color space" };
    }

    if (cs instanceof PDFLib.PDFRef) {
      var resolved = context.lookup(cs);
      if (resolved && resolved.dict) {
        var n = resolved.dict.get(PDFLib.PDFName.of("N"));
        var nVal = n && n.asNumber ? n.asNumber() : null;
        if (nVal === 1 || nVal === 3) return { ok: true };
        if (nVal === 4) return { ok: false, reason: "CMYK color profile" };
      }
      return { ok: false, reason: "unrecognised color profile" };
    }

    return { ok: false, reason: "unsupported color space" };
  }

  /* ------------------------------------------------------------- compress */

  function compressOneImage(ref, obj, context, quality, maxDim, stats) {
    var check = classifyImage(obj.dict, context);
    if (!check.ok) {
      stats.skipped[check.reason] = (stats.skipped[check.reason] || 0) + 1;
      return Promise.resolve();
    }

    var rawBytes = obj.getContents();

    return decodeJpeg(rawBytes).then(function (img) {
      var srcW = img.naturalWidth;
      var srcH = img.naturalHeight;
      var scale = maxDim ? Math.min(1, maxDim / Math.max(srcW, srcH)) : 1;
      var targetW = Math.max(1, Math.round(srcW * scale));
      var targetH = Math.max(1, Math.round(srcH * scale));

      var canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, targetW, targetH);

      return canvasToJpeg(canvas, quality).then(function (newBytes) {
        if (newBytes.length >= rawBytes.length) {
          stats.keptAsIs++;
          return;
        }

        var newDict = obj.dict.clone(context);
        newDict.set(PDFLib.PDFName.of("Width"), PDFLib.PDFNumber.of(targetW));
        newDict.set(PDFLib.PDFName.of("Height"), PDFLib.PDFNumber.of(targetH));
        newDict.set(PDFLib.PDFName.of("Length"), PDFLib.PDFNumber.of(newBytes.length));

        var newStream = PDFLib.PDFRawStream.of(newDict, newBytes);
        context.assign(ref, newStream);

        stats.recompressed++;
        stats.bytesSaved += (rawBytes.length - newBytes.length);
      });
    }).catch(function () {
      stats.skipped["couldn't be decoded"] = (stats.skipped["couldn't be decoded"] || 0) + 1;
    });
  }

  function compress() {
    if (busy || !doc) return;

    busy = true;
    updateActionState();

    var quality = parseInt(el.quality.value, 10) / 100;
    var maxDim = parseInt(el.maxDim.value, 10) || 0; // 0 = no limit

    var stats = { recompressed: 0, keptAsIs: 0, bytesSaved: 0, skipped: {} };

    PDFLib.PDFDocument.load(doc.bytes).then(function (loaded) {
      var context = loaded.context;
      var images = [];

      context.enumerateIndirectObjects().forEach(function (entry) {
        var ref = entry[0];
        var obj = entry[1];
        if (obj instanceof PDFLib.PDFRawStream) {
          var subtype = obj.dict.get(PDFLib.PDFName.of("Subtype"));
          if (subtype instanceof PDFLib.PDFName && subtype.toString() === "/Image") {
            images.push({ ref: ref, obj: obj });
          }
        }
      });

      if (!images.length) {
        status("No JPEG images found to compress in this PDF.", "error");
        busy = false;
        updateActionState();
        return null;
      }

      var chain = Promise.resolve();
      images.forEach(function (item, index) {
        chain = chain.then(function () {
          status("Compressing image " + (index + 1) + " of " + images.length + " \u2026");
          return compressOneImage(item.ref, item.obj, context, quality, maxDim, stats);
        });
      });

      return chain.then(function () { return loaded.save(); });
    }).then(function (bytes) {
      if (!bytes) return; // no images found, already handled above

      var skippedParts = Object.keys(stats.skipped).map(function (reason) {
        return stats.skipped[reason] + " (" + reason + ")";
      });

      var summary = plural(stats.recompressed, "image") + " recompressed";
      if (stats.keptAsIs) summary += ", " + plural(stats.keptAsIs, "image") + " already optimal";
      if (skippedParts.length) summary += ", skipped: " + skippedParts.join(", ");

      if (bytes.length >= doc.size) {
        status(summary + ". This PDF didn't get smaller \u2014 it may already be optimized.", "error");
      } else {
        var reduction = Math.round(100 * (1 - bytes.length / doc.size));
        status(summary + ". " + formatSize(doc.size) + " \u2192 " + formatSize(bytes.length) +
               " (" + reduction + "% smaller).", "ok");
      }

      downloadPdf(bytes, el.name.value);
    }).catch(function (err) {
      console.error(err);
      status("Compression failed: " + describeLoadError(err) + ".", "error");
    }).then(function () {
      busy = false;
      updateActionState();
    });
  }

  /* -------------------------------------------------------------- output */

  function downloadPdf(bytes, name) {
    var filename = (name || "compressed").trim().replace(/\.pdf$/i, "").replace(/[\/\\:*?"<>|]/g, "-");
    if (!filename) filename = "compressed";

    var url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = filename + ".pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ------------------------------------------------------------- add file */

  function addFile(file) {
    if (!file) return;

    status("Reading \u2026");

    readAsArrayBuffer(file).then(function (buffer) {
      return PDFLib.PDFDocument.load(buffer).then(function () {
        doc = { name: file.name, size: file.size, bytes: buffer };

        el.fileMeta.textContent = doc.name + " \u00b7 " + formatSize(doc.size);
        el.workWrap.hidden = false;
        el.name.value = doc.name.replace(/\.pdf$/i, "") + "-compressed";

        updateActionState();
        status("Ready.", "ok");
      });
    }).catch(function (err) {
      status(file.name + " " + describeLoadError(err) + ".", "error");
    });
  }

  function reset() {
    doc = null;
    el.workWrap.hidden = true;
    updateActionState();
    status("");
  }

  function updateActionState() {
    el.go.disabled = busy || !doc;
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

  el.quality.addEventListener("input", function () {
    el.qualityVal.textContent = el.quality.value + "%";
  });

  el.go.addEventListener("click", compress);

  updateActionState();
})();
