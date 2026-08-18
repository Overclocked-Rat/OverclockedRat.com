(function () {
  var CATEGORIES = {
    length: {
      label: 'Length',
      units: {
        mm: { label: 'Millimeters (mm)', factor: 0.001 },
        cm: { label: 'Centimeters (cm)', factor: 0.01 },
        m: { label: 'Meters (m)', factor: 1 },
        km: { label: 'Kilometers (km)', factor: 1000 },
        in: { label: 'Inches (in)', factor: 0.0254 },
        ft: { label: 'Feet (ft)', factor: 0.3048 },
        yd: { label: 'Yards (yd)', factor: 0.9144 },
        mi: { label: 'Miles (mi)', factor: 1609.344 }
      }
    },
    weight: {
      label: 'Weight',
      units: {
        mg: { label: 'Milligrams (mg)', factor: 0.001 },
        g: { label: 'Grams (g)', factor: 1 },
        kg: { label: 'Kilograms (kg)', factor: 1000 },
        t: { label: 'Tonnes (t)', factor: 1000000 },
        oz: { label: 'Ounces (oz)', factor: 28.349523125 },
        lb: { label: 'Pounds (lb)', factor: 453.59237 }
      }
    },
    data: {
      label: 'Data Storage',
      note: 'Uses 1024-based (binary) conversion, matching how most operating systems report file sizes.',
      units: {
        b: { label: 'Bits (b)', factor: 1 / 8 },
        B: { label: 'Bytes (B)', factor: 1 },
        KB: { label: 'Kilobytes (KB)', factor: 1024 },
        MB: { label: 'Megabytes (MB)', factor: Math.pow(1024, 2) },
        GB: { label: 'Gigabytes (GB)', factor: Math.pow(1024, 3) },
        TB: { label: 'Terabytes (TB)', factor: Math.pow(1024, 4) }
      }
    },
    temperature: {
      label: 'Temperature',
      special: true,
      units: {
        c: { label: 'Celsius (°C)' },
        f: { label: 'Fahrenheit (°F)' },
        k: { label: 'Kelvin (K)' }
      }
    }
  };

  var TEMP_TO_CELSIUS = {
    c: function (v) { return v; },
    f: function (v) { return (v - 32) * 5 / 9; },
    k: function (v) { return v - 273.15; }
  };
  var TEMP_FROM_CELSIUS = {
    c: function (v) { return v; },
    f: function (v) { return v * 9 / 5 + 32; },
    k: function (v) { return v + 273.15; }
  };

  function formatNumber(n) {
    if (!isFinite(n)) return '—';
    if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-9 && n !== 0)) {
      return n.toExponential(6);
    }
    var rounded = Math.round(n * 1e9) / 1e9;
    return rounded.toString();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('unit-converter');
    if (!root) return;

    var categorySelect = root.querySelector('#uc-category');
    var fromSelect = root.querySelector('#uc-from');
    var toSelect = root.querySelector('#uc-to');
    var valueInput = root.querySelector('#uc-value');
    var resultOutput = root.querySelector('#uc-result');
    var swapBtn = root.querySelector('#uc-swap');
    var noteEl = root.querySelector('#uc-note');

    function populateUnits(categoryKey) {
      var category = CATEGORIES[categoryKey];
      fromSelect.innerHTML = '';
      toSelect.innerHTML = '';
      var keys = Object.keys(category.units);
      keys.forEach(function (key, i) {
        var unit = category.units[key];
        var opt1 = document.createElement('option');
        opt1.value = key;
        opt1.textContent = unit.label;
        fromSelect.appendChild(opt1);

        var opt2 = document.createElement('option');
        opt2.value = key;
        opt2.textContent = unit.label;
        toSelect.appendChild(opt2);
      });
      fromSelect.selectedIndex = 0;
      toSelect.selectedIndex = Math.min(1, keys.length - 1);

      if (category.note) {
        noteEl.textContent = category.note;
        noteEl.classList.remove('d-none');
      } else {
        noteEl.classList.add('d-none');
      }
    }

    function convert() {
      var categoryKey = categorySelect.value;
      var category = CATEGORIES[categoryKey];
      var value = parseFloat(valueInput.value);
      var fromKey = fromSelect.value;
      var toKey = toSelect.value;

      if (isNaN(value)) {
        resultOutput.value = '';
        return;
      }

      var result;
      if (category.special) {
        var celsius = TEMP_TO_CELSIUS[fromKey](value);
        result = TEMP_FROM_CELSIUS[toKey](celsius);
      } else {
        var fromFactor = category.units[fromKey].factor;
        var toFactor = category.units[toKey].factor;
        var valueInBase = value * fromFactor;
        result = valueInBase / toFactor;
      }

      resultOutput.value = formatNumber(result);
    }

    categorySelect.addEventListener('change', function () {
      populateUnits(categorySelect.value);
      convert();
    });
    fromSelect.addEventListener('change', convert);
    toSelect.addEventListener('change', convert);
    valueInput.addEventListener('input', convert);
    swapBtn.addEventListener('click', function () {
      var fromIndex = fromSelect.selectedIndex;
      fromSelect.selectedIndex = toSelect.selectedIndex;
      toSelect.selectedIndex = fromIndex;
      convert();
    });

    populateUnits(categorySelect.value);
    valueInput.value = '1';
    convert();
  });
})();
