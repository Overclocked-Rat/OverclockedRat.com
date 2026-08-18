(function () {
  var ZONES = [
    { value: 'UTC', label: 'UTC' },
    { value: 'Australia/Perth', label: 'Perth, Australia' },
    { value: 'Australia/Adelaide', label: 'Adelaide, Australia' },
    { value: 'Australia/Brisbane', label: 'Brisbane, Australia' },
    { value: 'Australia/Sydney', label: 'Sydney, Australia' },
    { value: 'Pacific/Auckland', label: 'Auckland, New Zealand' },
    { value: 'Asia/Tokyo', label: 'Tokyo, Japan' },
    { value: 'Asia/Shanghai', label: 'Shanghai, China' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
    { value: 'Asia/Singapore', label: 'Singapore' },
    { value: 'Asia/Seoul', label: 'Seoul, South Korea' },
    { value: 'Asia/Kolkata', label: 'Mumbai / Delhi, India' },
    { value: 'Asia/Jakarta', label: 'Jakarta, Indonesia' },
    { value: 'Asia/Dubai', label: 'Dubai, UAE' },
    { value: 'Europe/Istanbul', label: 'Istanbul, Turkey' },
    { value: 'Europe/Moscow', label: 'Moscow, Russia' },
    { value: 'Europe/Berlin', label: 'Berlin, Germany' },
    { value: 'Europe/Paris', label: 'Paris, France' },
    { value: 'Europe/London', label: 'London, UK' },
    { value: 'Africa/Cairo', label: 'Cairo, Egypt' },
    { value: 'Africa/Johannesburg', label: 'Johannesburg, South Africa' },
    { value: 'America/Sao_Paulo', label: 'São Paulo, Brazil' },
    { value: 'America/New_York', label: 'New York, USA' },
    { value: 'America/Chicago', label: 'Chicago, USA' },
    { value: 'America/Denver', label: 'Denver, USA' },
    { value: 'America/Los_Angeles', label: 'Los Angeles, USA' },
    { value: 'America/Anchorage', label: 'Anchorage, USA' },
    { value: 'Pacific/Honolulu', label: 'Honolulu, Hawaii' },
    { value: 'America/Mexico_City', label: 'Mexico City, Mexico' }
  ];

  function getTimeZoneOffsetMinutes(date, timeZone) {
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var parts = dtf.formatToParts(date).reduce(function (acc, p) {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
    var asUTC = Date.UTC(
      parseInt(parts.year, 10), parseInt(parts.month, 10) - 1, parseInt(parts.day, 10),
      parseInt(parts.hour, 10), parseInt(parts.minute, 10), parseInt(parts.second, 10)
    );
    return (asUTC - date.getTime()) / 60000;
  }

  function utcInstantForWallTime(y, mo, d, h, mi, timeZone) {
    var guess = Date.UTC(y, mo - 1, d, h, mi);
    var offset = getTimeZoneOffsetMinutes(new Date(guess), timeZone);
    var utcMillis = guess - offset * 60000;
    var refinedOffset = getTimeZoneOffsetMinutes(new Date(utcMillis), timeZone);
    if (refinedOffset !== offset) {
      utcMillis = guess - refinedOffset * 60000;
    }
    return new Date(utcMillis);
  }

  function formatOffset(minutes) {
    var sign = minutes >= 0 ? '+' : '-';
    var abs = Math.abs(minutes);
    var h = Math.floor(abs / 60);
    var m = abs % 60;
    return 'UTC' + sign + h + (m ? ':' + (m < 10 ? '0' : '') + m : '');
  }

  function formatInZone(date, timeZone) {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
    return fmt.format(date);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('timezone-converter');
    if (!root) return;

    var dateInput = root.querySelector('#tz-datetime');
    var sourceSelect = root.querySelector('#tz-source');
    var targetList = root.querySelector('#tz-target-list');
    var addSelect = root.querySelector('#tz-add-select');
    var addBtn = root.querySelector('#tz-add-btn');

    var detectedZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    function populateSelect(selectEl, includeDetectedFirst) {
      selectEl.innerHTML = '';
      var list = ZONES.slice();
      if (list.every(function (z) { return z.value !== detectedZone; })) {
        list.unshift({ value: detectedZone, label: detectedZone.replace('_', ' ') + ' (detected)' });
      }
      list.forEach(function (zone) {
        var opt = document.createElement('option');
        opt.value = zone.value;
        opt.textContent = zone.label;
        selectEl.appendChild(opt);
      });
      if (includeDetectedFirst) selectEl.value = detectedZone;
    }

    var targetZones = [];

    function defaultTargets() {
      var defaults = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
      return defaults.filter(function (z) { return z !== detectedZone; }).slice(0, 4);
    }

    function renderTargets() {
      targetList.innerHTML = '';
      var y, mo, d, h, mi;
      var parts = dateInput.value.split(/[-T:]/);
      if (parts.length < 5) return;
      y = parseInt(parts[0], 10); mo = parseInt(parts[1], 10); d = parseInt(parts[2], 10);
      h = parseInt(parts[3], 10); mi = parseInt(parts[4], 10);

      var utcInstant = utcInstantForWallTime(y, mo, d, h, mi, sourceSelect.value);

      targetZones.forEach(function (zoneValue) {
        var zoneMeta = ZONES.filter(function (z) { return z.value === zoneValue; })[0];
        var label = zoneMeta ? zoneMeta.label : zoneValue;
        var offsetMin = getTimeZoneOffsetMinutes(utcInstant, zoneValue);

        var row = document.createElement('div');
        row.className = 'd-flex align-items-center justify-content-between border-bottom py-2';
        row.innerHTML =
          '<div>' +
            '<div class="fw-medium">' + label + '</div>' +
            '<div class="text-muted small">' + formatInZone(utcInstant, zoneValue) + ' &middot; ' + formatOffset(offsetMin) + '</div>' +
          '</div>';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-sm btn-outline-secondary';
        removeBtn.setAttribute('aria-label', 'Remove ' + label);
        removeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
        removeBtn.addEventListener('click', function () {
          targetZones = targetZones.filter(function (z) { return z !== zoneValue; });
          renderTargets();
        });

        row.appendChild(removeBtn);
        targetList.appendChild(row);
      });

      if (targetZones.length === 0) {
        var empty = document.createElement('p');
        empty.className = 'text-muted mb-0';
        empty.textContent = 'Add a timezone below to compare.';
        targetList.appendChild(empty);
      }
    }

    populateSelect(sourceSelect, true);
    populateSelect(addSelect, false);

    var now = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    dateInput.value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
      'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());

    targetZones = defaultTargets();
    renderTargets();

    dateInput.addEventListener('input', renderTargets);
    sourceSelect.addEventListener('change', renderTargets);
    addBtn.addEventListener('click', function () {
      var zone = addSelect.value;
      if (zone && targetZones.indexOf(zone) === -1 && zone !== sourceSelect.value) {
        targetZones.push(zone);
        renderTargets();
      }
    });
  });
})();
