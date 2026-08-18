(function () {
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  }

  var started = false;
  function init() {
    if (started) return;
    var container = document.getElementById('boid-enclosure');
    var canvas = document.getElementById('boid-canvas');
    if (!container || !canvas) return;
    started = true;

    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;

    var W = 0, H = 0;
    function resize() {
      var rect = container.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(container);
    } else {
      window.addEventListener('resize', resize);
    }

    var N = 40;
    var PRED_COUNT = 2;
    var MIN_SCALE = 0.45;
    var MAX_SCALE = 1.3;
    var GROW_RATE = 0.0025;
    var KILL_RADIUS = 13;
    var NEAR_MISS_RADIUS = 27;
    var FLASH_MS = 260;
    var FLASH_COOLDOWN = 500;
    var SPAWN_FADE_MS = 320;
    var TRAIL_LEN = 40;
    var PRED_TRAIL_LEN = 24;
    var EFFECT_RADIUS = 100;
    var ALARM_RADIUS = 40;
    var PANIC_THRESHOLD = 0.35;
    var MAX_SPEED_MULT = 2.6;
    var PARTICLE_LIFE = 550;

    function makeBoid(now) {
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        scale: MIN_SCALE,
        shade: Math.random(),
        trail: [],
        state: 'alive',
        respawnAt: 0,
        spawnedAt: now,
        rawThreatT: 0,
        threatT: 0,
        flashUntil: 0
      };
    }

    var boids = [];
    for (var i = 0; i < N; i++) boids.push(makeBoid(-9999));
    var particles = [];

    var predators = [];
    for (var pI = 0; pI < PRED_COUNT; pI++) {
      predators.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
        scale: 1.4,
        wanderX: 0, wanderY: 0, wanderTimer: 0,
        trail: [],
        sprintUntil: 0,
        nextSprintAt: 1500 + Math.random() * 2000
      });
    }

    var mouse = { x: -1000, y: -1000, active: false };
    canvas.addEventListener('mousemove', function (e) {
      var rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    });
    canvas.addEventListener('mouseleave', function () { mouse.active = false; });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length) {
        var rect = canvas.getBoundingClientRect();
        mouse.x = e.touches[0].clientX - rect.left;
        mouse.y = e.touches[0].clientY - rect.top;
        mouse.active = true;
      }
    }, { passive: true });
    canvas.addEventListener('touchend', function () { mouse.active = false; });

    function readColorVar(name, fallback) {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    }
    function hexToRgb(hex) {
      hex = hex.replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
      var num = parseInt(hex, 16);
      return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }
    function parseColor(str, fallback) {
      str = (str || '').trim();
      var rgbMatch = str.match(/rgba?\(([^)]+)\)/);
      if (rgbMatch) {
        var parts = rgbMatch[1].split(/[,\s/]+/).map(Number);
        return { r: parts[0], g: parts[1], b: parts[2] };
      }
      if (str.indexOf('#') === 0) return hexToRgb(str);
      return fallback;
    }

    var accentStr = readColorVar('--link-color', '#8ab4f8');
    var base = parseColor(accentStr, { r: 138, g: 180, b: 248 });
    var GRAY = { r: 130, g: 130, b: 130 };
    var orange = { r: 255, g: 130, b: 20 };
    var white = { r: 255, g: 255, b: 255 };
    var predatorColor = { r: 214, g: 48, b: 42 };

    function baseRgb(shade) {
      var f = 0.75 + shade * 0.5;
      var r = Math.min(255, Math.round(base.r * f));
      var g = Math.min(255, Math.round(base.g * f));
      var b = Math.min(255, Math.round(base.b * f));
      return {
        r: Math.round(r * 0.82 + GRAY.r * 0.18),
        g: Math.round(g * 0.82 + GRAY.g * 0.18),
        b: Math.round(b * 0.82 + GRAY.b * 0.18)
      };
    }
    function mix(c1, c2, t) {
      return {
        r: Math.round(c1.r * (1 - t) + c2.r * t),
        g: Math.round(c1.g * (1 - t) + c2.g * t),
        b: Math.round(c1.b * (1 - t) + c2.b * t)
      };
    }
    function toRgba(c, alpha) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')'; }
    function bodyColor(b, now) {
      var c = baseRgb(b.shade);
      if (b.threatT > 0) c = mix(c, orange, Math.min(1, b.threatT) * 0.85);
      if (now < b.flashUntil) {
        var flashFrac = Math.max(0, (b.flashUntil - now) / FLASH_MS);
        c = mix(c, white, flashFrac * 0.7);
      }
      return c;
    }
    function trailColor(shade, warmT) {
      var c = baseRgb(shade);
      return mix(c, orange, Math.min(1, warmT) * 0.35);
    }
    function predatorRgba(alpha) { return toRgba(predatorColor, alpha); }

    function explode(b, now) {
      var speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      var baseAngle = Math.atan2(b.vy, b.vx) || 0;
      var count = 5 + Math.floor(Math.random() * 4);
      for (var k = 0; k < count; k++) {
        var spread = (Math.random() - 0.5) * 2.2;
        var pSpeed = speed * (0.6 + Math.random() * 1.4) + 0.3;
        var angle = baseAngle + spread;
        particles.push({
          x: b.x, y: b.y,
          vx: Math.cos(angle) * pSpeed,
          vy: Math.sin(angle) * pSpeed,
          size: (0.9 + Math.random() * 1.3) * b.scale,
          shade: b.shade,
          spawnedAt: now
        });
      }
    }

    function updatePredators(now) {
      for (var pI = 0; pI < predators.length; pI++) {
        var predator = predators[pI];
        var target = null;
        var bestD = Infinity;
        for (var i = 0; i < boids.length; i++) {
          var o = boids[i];
          if (o.state !== 'alive') continue;
          var dx = o.x - predator.x, dy = o.y - predator.y;
          var d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; target = o; }
        }

        predator.wanderTimer -= 1;
        if (predator.wanderTimer <= 0) {
          predator.wanderX = (Math.random() - 0.5) * 1.4;
          predator.wanderY = (Math.random() - 0.5) * 1.4;
          predator.wanderTimer = 30 + Math.random() * 40;
        }

        var sprinting = now < predator.sprintUntil;
        if (!sprinting && now >= predator.nextSprintAt) {
          predator.sprintUntil = now + 400 + Math.random() * 500;
          predator.nextSprintAt = predator.sprintUntil + 2000 + Math.random() * 3500;
          sprinting = true;
        }

        var maxSpeed = sprinting ? 4.4 : 2.6;
        var steerForce = sprinting ? 0.26 : 0.16;

        if (target) {
          var tx = target.x - predator.x, ty = target.y - predator.y;
          var td = Math.sqrt(tx * tx + ty * ty) || 1;
          predator.vx += (tx / td) * steerForce + predator.wanderX * 0.03;
          predator.vy += (ty / td) * steerForce + predator.wanderY * 0.03;
        } else {
          predator.vx += predator.wanderX * 0.05;
          predator.vy += predator.wanderY * 0.05;
        }

        var margin = 16;
        if (predator.x < margin) predator.vx += 0.2;
        if (predator.x > W - margin) predator.vx -= 0.2;
        if (predator.y < margin) predator.vy += 0.2;
        if (predator.y > H - margin) predator.vy -= 0.2;

        var ps = Math.sqrt(predator.vx * predator.vx + predator.vy * predator.vy);
        if (ps > maxSpeed) { predator.vx = predator.vx / ps * maxSpeed; predator.vy = predator.vy / ps * maxSpeed; }
        if (ps < 0.8 && ps > 0) { predator.vx = predator.vx / ps * 0.8; predator.vy = predator.vy / ps * 0.8; }

        predator.x += predator.vx;
        predator.y += predator.vy;
        predator.x = Math.max(2, Math.min(W - 2, predator.x));
        predator.y = Math.max(2, Math.min(H - 2, predator.y));

        predator.trail.push({ x: predator.x, y: predator.y });
        if (predator.trail.length > PRED_TRAIL_LEN) predator.trail.shift();
      }
    }

    function step(now) {
      var neighborDist = 40;
      var sepDist = 20;
      var maxSpeed = 2.0;

      updatePredators(now);

      var aliveList = boids.filter(function (b) { return b.state === 'alive'; });

      for (var a = 0; a < aliveList.length; a++) {
        var ba = aliveList[a];
        var mdx = ba.x - mouse.x, mdy = ba.y - mouse.y;
        var mouseD = mouse.active ? Math.sqrt(mdx * mdx + mdy * mdy) : Infinity;
        var best = mouseD < EFFECT_RADIUS ? (1 - mouseD / EFFECT_RADIUS) : 0;
        for (var pk = 0; pk < predators.length; pk++) {
          var pr = predators[pk];
          var pdx = ba.x - pr.x, pdy = ba.y - pr.y;
          var pd = Math.sqrt(pdx * pdx + pdy * pdy);
          if (pd < EFFECT_RADIUS) {
            var t = 1 - pd / EFFECT_RADIUS;
            if (t > best) best = t;
          }
        }
        ba.rawThreatT = best;
      }

      for (var b1 = 0; b1 < aliveList.length; b1++) {
        var boidA = aliveList[b1];
        var finalT = boidA.rawThreatT;
        for (var b2 = 0; b2 < aliveList.length; b2++) {
          if (b1 === b2) continue;
          var boidB = aliveList[b2];
          if (boidB.rawThreatT < PANIC_THRESHOLD) continue;
          var ddx = boidA.x - boidB.x, ddy = boidA.y - boidB.y;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd < ALARM_RADIUS) {
            var propagated = boidB.rawThreatT * 0.5;
            if (propagated > finalT) finalT = propagated;
          }
        }
        boidA.threatT = finalT;
      }

      for (var i = 0; i < boids.length; i++) {
        var b = boids[i];

        if (b.state === 'waiting') {
          if (now >= b.respawnAt) boids[i] = makeBoid(now);
          continue;
        }

        var mdx0 = b.x - mouse.x, mdy0 = b.y - mouse.y;
        var mouseD2 = mouse.active ? Math.sqrt(mdx0 * mdx0 + mdy0 * mdy0) : Infinity;
        var nearestD = mouseD2;
        for (var pk2 = 0; pk2 < predators.length; pk2++) {
          var pr2 = predators[pk2];
          var pdx2 = b.x - pr2.x, pdy2 = b.y - pr2.y;
          var pd2 = Math.sqrt(pdx2 * pdx2 + pdy2 * pdy2);
          if (pd2 < nearestD) nearestD = pd2;
        }

        if (nearestD < KILL_RADIUS) {
          explode(b, now);
          b.state = 'waiting';
          b.respawnAt = now + 2000 + Math.random() * 3000;
          b.trail = [];
          continue;
        }

        if (nearestD < NEAR_MISS_RADIUS && now - b.flashUntil > FLASH_COOLDOWN + FLASH_MS) {
          b.flashUntil = now + FLASH_MS;
        }

        var alignX = 0, alignY = 0, alignN = 0;
        var cohX = 0, cohY = 0, cohN = 0;
        var sepX = 0, sepY = 0;

        for (var j = 0; j < boids.length; j++) {
          if (i === j) continue;
          var o = boids[j];
          if (o.state !== 'alive') continue;
          var dx = o.x - b.x, dy = o.y - b.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < neighborDist && d > 0) {
            alignX += o.vx; alignY += o.vy; alignN++;
            cohX += o.x; cohY += o.y; cohN++;
          }
          if (d < sepDist && d > 0) { sepX -= dx / d; sepY -= dy / d; }
        }

        if (alignN > 0) { alignX /= alignN; alignY /= alignN; }
        if (cohN > 0) { cohX = cohX / cohN - b.x; cohY = cohY / cohN - b.y; }

        b.vx += alignX * 0.02 + cohX * 0.0008 + sepX * 0.05;
        b.vy += alignY * 0.02 + cohY * 0.0008 + sepY * 0.05;

        if (mouseD2 < EFFECT_RADIUS && mouseD2 > 0) {
          var tm = 1 - mouseD2 / EFFECT_RADIUS;
          b.vx += (mdx0 / mouseD2) * tm * 0.9;
          b.vy += (mdy0 / mouseD2) * tm * 0.9;
        }
        for (var pk3 = 0; pk3 < predators.length; pk3++) {
          var pr3 = predators[pk3];
          var pdx3 = b.x - pr3.x, pdy3 = b.y - pr3.y;
          var pd3 = Math.sqrt(pdx3 * pdx3 + pdy3 * pdy3);
          if (pd3 < EFFECT_RADIUS && pd3 > 0) {
            var tp = 1 - pd3 / EFFECT_RADIUS;
            b.vx += (pdx3 / pd3) * tp * 1.0;
            b.vy += (pdy3 / pd3) * tp * 1.0;
          }
        }

        var speedMult = 1 + Math.min(1, b.threatT) * (MAX_SPEED_MULT - 1);

        var margin = 16;
        if (b.x < margin) b.vx += 0.15;
        if (b.x > W - margin) b.vx -= 0.15;
        if (b.y < margin) b.vy += 0.15;
        if (b.y > H - margin) b.vy -= 0.15;

        var speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (speed > maxSpeed) { b.vx = b.vx / speed * maxSpeed; b.vy = b.vy / speed * maxSpeed; }
        if (speed < 0.6 && speed > 0) { b.vx = b.vx / speed * 0.6; b.vy = b.vy / speed * 0.6; }

        b.x += b.vx * speedMult;
        b.y += b.vy * speedMult;
        b.x = Math.max(2, Math.min(W - 2, b.x));
        b.y = Math.max(2, Math.min(H - 2, b.y));

        if (b.scale < MAX_SCALE) b.scale = Math.min(MAX_SCALE, b.scale + GROW_RATE);

        var warmT = Math.min(1, (speed * speedMult) / 5.2);
        b.trail.push({ x: b.x, y: b.y, scale: b.scale, warmT: warmT });
        if (b.trail.length > TRAIL_LEN) b.trail.shift();
      }

      for (var p = particles.length - 1; p >= 0; p--) {
        var pt = particles[p];
        if (now - pt.spawnedAt >= PARTICLE_LIFE) { particles.splice(p, 1); continue; }
        pt.x += pt.vx; pt.y += pt.vy;
        pt.vx *= 0.94; pt.vy *= 0.94;
      }
    }

    function drawGrid() {
      var spacing = 22;
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#ffffff';
      for (var gx = spacing / 2; gx < W; gx += spacing) {
        for (var gy = spacing / 2; gy < H; gy += spacing) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    function draw(now) {
      ctx.clearRect(0, 0, W, H);
      drawGrid();

      for (var pI = 0; pI < predators.length; pI++) {
        var predator = predators[pI];
        for (var t0 = 0; t0 < predator.trail.length; t0++) {
          var ppt = predator.trail[t0];
          var pfrac = t0 / predator.trail.length;
          var palpha = pfrac * pfrac * 0.45;
          var pr = 2.2 * predator.scale * pfrac;
          ctx.beginPath();
          ctx.arc(ppt.x, ppt.y, pr, 0, Math.PI * 2);
          ctx.fillStyle = predatorRgba(palpha);
          ctx.fill();
        }
      }

      for (var i = 0; i < boids.length; i++) {
        var b = boids[i];
        if (b.state === 'waiting') continue;
        var spawnAlpha = Math.min(1, (now - b.spawnedAt) / SPAWN_FADE_MS);

        for (var t = 0; t < b.trail.length; t++) {
          var pt = b.trail[t];
          var frac = t / b.trail.length;
          var alpha = frac * frac * 0.4 * spawnAlpha;
          var r = 1.8 * pt.scale * frac;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fillStyle = toRgba(trailColor(b.shade, pt.warmT || 0), alpha);
          ctx.fill();
        }

        var angle = Math.atan2(b.vy, b.vx) || 0;
        var flashScale = now < b.flashUntil ? 1 + 0.22 * ((b.flashUntil - now) / FLASH_MS) : 1;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(angle);
        ctx.scale(b.scale * flashScale, b.scale * flashScale);
        ctx.beginPath();
        ctx.moveTo(5.5, 0);
        ctx.lineTo(-4.5, 3.2);
        ctx.lineTo(-4.5, -3.2);
        ctx.closePath();
        ctx.fillStyle = toRgba(bodyColor(b, now), spawnAlpha);
        ctx.fill();
        ctx.restore();
      }

      for (var p2 = 0; p2 < particles.length; p2++) {
        var pp = particles[p2];
        var age = (now - pp.spawnedAt) / PARTICLE_LIFE;
        var alpha = Math.max(0, 1 - age);
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, pp.size, 0, Math.PI * 2);
        ctx.fillStyle = toRgba(baseRgb(pp.shade), alpha);
        ctx.fill();
      }

      for (var pI2 = 0; pI2 < predators.length; pI2++) {
        var predator2 = predators[pI2];
        var glowR = predator2.scale * 16;
        var grad = ctx.createRadialGradient(predator2.x, predator2.y, 0, predator2.x, predator2.y, glowR);
        grad.addColorStop(0, predatorRgba(0.32));
        grad.addColorStop(1, predatorRgba(0));
        ctx.beginPath();
        ctx.fillStyle = grad;
        ctx.arc(predator2.x, predator2.y, glowR, 0, Math.PI * 2);
        ctx.fill();

        var pangle = Math.atan2(predator2.vy, predator2.vx) || 0;
        ctx.save();
        ctx.translate(predator2.x, predator2.y);
        ctx.rotate(pangle);
        ctx.scale(predator2.scale, predator2.scale);
        ctx.beginPath();
        ctx.moveTo(6.5, 0);
        ctx.lineTo(-5, 3.6);
        ctx.lineTo(-5, -3.6);
        ctx.closePath();
        ctx.fillStyle = predatorRgba(1);
        ctx.fill();
        ctx.restore();
      }
    }

    function loop(now) {
      step(now);
      draw(now);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
})();
