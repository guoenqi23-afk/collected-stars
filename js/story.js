/*
 * The Girl Who Collected Stars — interactive story logic (CreateJS)
 *
 * Works in two places:
 *   1. Standalone page (index.html) with CreateJS from the CDN.
 *   2. Adobe Animate HTML5 Canvas document: include this file as a global
 *      script, then on frame 1 of the main timeline call:
 *        StarStory.init(this, { stage: stage, poster: new lib.Poster() });
 *
 * Stage size: 1080 x 1620 (portrait, 2:3).
 * Story: Collect (stars fall into the jar, sky darkens)
 *        -> Prompt (tap the jar)
 *        -> Release (stars fly back, sky brightens) -> ending line.
 */
(function (global) {
  'use strict';

  // Key points of the poster artwork, in ARTWORK pixels (poster.jpg is 2048 x 1361).
  var ART = {
    w: 2048, h: 1361,
    jar: { x: 1187, y: 756, mouthX: 1186, mouthY: 656, hitW: 314, hitH: 343 },
    girl: { x: 1042, y: 542, rx: 200, ry: 448 }      // keep stars off the girl
  };

  // Two layouts share the same story:
  //  - portrait: phone page, artwork cropped into a 2:3 stage with extra sky on top
  //  - ar:       transparent overlay drawn exactly on top of the printed artwork
  var LAYOUTS = {
    portrait: {
      W: 1080, H: 1620, art: { scale: 1.05, x: -534, y: 191 },
      focusX: 600, textW: 660, background: true, intro: true, darkR: 1100,
      starBand: { x0: 240, x1: 960, y0: 340, y1: 1050 }, starGap: 105,
      text: { q: [150, 52], hint: [1236, 42], end: [140, 56], title: [170, 84], start: [1380, 38], replay: 1500 }
    },
    ar: {
      W: 2048, H: 1361, art: { scale: 1, x: 0, y: 0 },
      focusX: 1100, textW: 1500, background: false, intro: false, darkR: 1500,
      starBand: { x0: 120, x1: 1940, y0: 300, y1: 1010 }, starGap: 150,
      text: { q: [40, 78], hint: [1190, 60], end: [40, 84], title: [60, 90], start: [1200, 50], replay: 1290 }
    }
  };

  // Active layout values (set in init)
  var W, H, POSTER, JAR, FOCUS_X, TEXT_W;
  function applyLayout(L) {
    W = L.W; H = L.H; POSTER = L.art; FOCUS_X = L.focusX; TEXT_W = L.textW;
    var s = POSTER.scale;
    JAR = { x: POSTER.x + ART.jar.x * s, y: POSTER.y + ART.jar.y * s,
            mouthX: POSTER.x + ART.jar.mouthX * s, mouthY: POSTER.y + ART.jar.mouthY * s,
            hitW: ART.jar.hitW * s, hitH: ART.jar.hitH * s };
  }

  // SKY_EDGE matches the average colour along the top edge of the poster
  var SKY_TOP = '#100b28', SKY_EDGE = 'rgba(28,21,62,1)', SKY_EDGE_0 = 'rgba(28,21,62,0)';
  var FONT = '"Cormorant Garamond", Georgia, "Times New Roman", serif';

  var TIMING = {
    calm: 1.6,           // shot 1: calm on the moon
    starInterval: 0.36,  // gap between falling stars
    fallDur: 1.9,        // flight time of one star into the jar
    afterDark: 0.7,      // pause before the question appears
    hintDelay: 1.3,      // question -> "tap the jar" hint
    releaseInterval: 0.13,
    riseDur: 2.3,
    endDelay: 0.8
  };
  var STAR_COUNT = 18;

  // ---------------------------------------------------------------- helpers
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function bez(p0, p1, p2, t) {
    var u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
             y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
  }
  function approach(cur, target, k, dt) { return cur + (target - cur) * (1 - Math.exp(-k * dt)); }

  function canvas(size) {
    var c = document.createElement('canvas'); c.width = c.height = size; return c;
  }

  // Hand-drawn-ish five point star with a warm glow, drawn once and reused.
  function makeStarSprite(seed) {
    var S = 128, c = canvas(S), g = c.getContext('2d'), cx = S / 2, cy = S / 2;
    var glow = g.createRadialGradient(cx, cy, 0, cx, cy, S / 2);
    glow.addColorStop(0, 'rgba(255,240,190,0.95)');
    glow.addColorStop(0.18, 'rgba(255,214,120,0.55)');
    glow.addColorStop(0.45, 'rgba(255,190,110,0.16)');
    glow.addColorStop(1, 'rgba(255,180,120,0)');
    g.fillStyle = glow; g.fillRect(0, 0, S, S);
    g.beginPath();
    var R = 19, r = 8.2, rot = -Math.PI / 2 + seed * 0.3;
    for (var i = 0; i < 10; i++) {
      var rr = (i % 2 ? r : R) * (1 + Math.sin(seed * 7 + i * 3.1) * 0.08);
      var a = rot + i * Math.PI / 5;
      var x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = '#fff8dc'; g.fill();
    g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,222,140,0.9)'; g.stroke();
    return c;
  }

  function makeDotSprite(inner, outer) {
    var S = 32, c = canvas(S), g = c.getContext('2d');
    var gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, inner); gr.addColorStop(0.35, outer); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return c;
  }

  function makeGlowSprite() {
    var S = 512, c = canvas(S), g = c.getContext('2d');
    var gr = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    gr.addColorStop(0, 'rgba(255,236,170,0.95)');
    gr.addColorStop(0.25, 'rgba(255,205,120,0.55)');
    gr.addColorStop(0.6, 'rgba(240,150,190,0.16)');
    gr.addColorStop(1, 'rgba(200,120,220,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return c;
  }

  function centeredBitmap(img, scale) {
    var b = new createjs.Bitmap(img);
    b.regX = img.width / 2; b.regY = img.height / 2;
    b.scaleX = b.scaleY = scale || 1;
    return b;
  }

  function makeText(str, size, color, italic) {
    var t = new createjs.Text(str, (italic ? 'italic ' : '') + '600 ' + size + 'px ' + FONT, color);
    t.textAlign = 'center'; t.textBaseline = 'top';
    t.lineWidth = TEXT_W; t.lineHeight = size * 1.25;
    t.shadow = new createjs.Shadow('rgba(255,210,150,0.65)', 0, 0, 18);
    return t;
  }

  // Simple HTML audio wrapper; missing files are ignored silently.
  function makeAudio(files) {
    var api = { unlocked: false, bgm: null, muted: false };
    function el(src, vol) {
      if (!src) return null;
      var a = new Audio(src); a.preload = 'auto'; a.volume = vol; return a;
    }
    api.bgm = el(files.bgm, 0.55);
    if (api.bgm) api.bgm.loop = true;
    var last = {};
    api.sfx = function (name, vol, minGap) {
      if (api.muted || !files[name]) return;
      var now = Date.now();
      if (last[name] && now - last[name] < (minGap || 0)) return;
      last[name] = now;
      var a = el(files[name], vol == null ? 0.6 : vol);
      var p = a.play(); if (p && p.catch) p.catch(function () {});
    };
    api.start = function () {
      api.unlocked = true;
      if (api.bgm && !api.muted) { var p = api.bgm.play(); if (p && p.catch) p.catch(function () {}); }
    };
    api.setMuted = function (m) {
      api.muted = m;
      if (!api.bgm) return;
      if (m) api.bgm.pause(); else if (api.unlocked) api.bgm.play();
    };
    return api;
  }

  // ------------------------------------------------------------------ init
  function init(root, opts) {
    opts = opts || {};
    var stage = opts.stage || root.stage;
    var L = LAYOUTS[opts.layout || 'portrait'];
    applyLayout(L);
    var audio = makeAudio(opts.audio || {});

    // ---- layers
    if (L.background) {
      var sky = new createjs.Shape();
      // only the band above the artwork, so a poster placed underneath stays visible
      sky.graphics.beginLinearGradientFill([SKY_TOP, SKY_EDGE], [0, 1], 0, 0, 0, POSTER.y)
        .drawRect(0, 0, W, POSTER.y + 2);
      root.addChild(sky);
    }

    if (opts.poster) {
      var poster = opts.poster;
      poster.x = POSTER.x; poster.y = POSTER.y;
      poster.scaleX = poster.scaleY = POSTER.scale;
      root.addChild(poster);
    }

    // soften the top edge of the artwork into the generated sky
    if (L.background && POSTER.y > 0) {
      var fade = new createjs.Shape();
      fade.graphics.beginLinearGradientFill([SKY_EDGE, SKY_EDGE_0], [0, 1],
        0, POSTER.y - 2, 0, POSTER.y + 160).drawRect(0, POSTER.y - 2, W, 164);
      root.addChild(fade);
    }

    var dotWarm = makeDotSprite('rgba(255,248,220,1)', 'rgba(255,220,150,0.5)');
    var dotCool = makeDotSprite('rgba(240,235,255,1)', 'rgba(190,170,255,0.45)');
    var dotPink = makeDotSprite('rgba(255,235,245,1)', 'rgba(255,170,210,0.5)');

    // tiny twinkling dust that thins out as the sky darkens
    var dust = new createjs.Container();
    dust.compositeOperation = 'lighter';
    var dustList = [];
    for (var d = 0; d < 90; d++) {
      var db = centeredBitmap(Math.random() < 0.6 ? dotCool : dotWarm, rand(0.18, 0.5));
      db.x = rand(0, W); db.y = rand(0, H * 0.71);
      dustList.push({ bmp: db, phase: rand(0, 6.28), speed: rand(0.8, 2.6), base: rand(0.35, 0.9), order: Math.random() });
      dust.addChild(db);
    }
    root.addChild(dust);

    // night overlay: darkest at the edges, lighter around the jar
    var dark = new createjs.Shape();
    dark.graphics.beginRadialGradientFill(
      ['rgba(6,5,22,0.30)', 'rgba(6,5,22,0.72)', 'rgba(4,3,16,0.93)'], [0, 0.35, 1],
      JAR.x, JAR.y, 0, JAR.x, JAR.y, L.darkR).drawRect(0, 0, W, H);
    dark.alpha = 0;
    root.addChild(dark);

    var glow = centeredBitmap(makeGlowSprite(), 0.9);
    glow.x = JAR.x; glow.y = JAR.y; glow.compositeOperation = 'lighter'; glow.alpha = 0.18;
    root.addChild(glow);

    var fx = new createjs.Container();   // trails & sparkles
    fx.compositeOperation = 'lighter';
    root.addChild(fx);

    var starLayer = new createjs.Container();
    starLayer.compositeOperation = 'lighter';
    root.addChild(starLayer);

    // ---- collectable stars, placed in the visible sky band
    var sprites = [makeStarSprite(0.2), makeStarSprite(1.3), makeStarSprite(2.7)];
    var stars = [];
    var tries = 0;
    while (stars.length < STAR_COUNT && tries++ < 4000) {
      // the band starts below the text lines so they never cover a star
      var B = L.starBand, ps = POSTER.scale;
      var hx = rand(B.x0, B.x1), hy = rand(B.y0, B.y1);
      // keep clear of the girl and the jar
      var gx = (hx - (POSTER.x + ART.girl.x * ps)) / (ART.girl.rx * ps * 1.05);
      var gy = (hy - (POSTER.y + ART.girl.y * ps)) / (ART.girl.ry * ps * 1.05);
      if (gx * gx + gy * gy < 1) continue;
      if (Math.abs(hx - JAR.x) < JAR.hitW * 0.55 && hy > JAR.y - JAR.hitH * 0.85) continue;
      var ok = true;
      for (var k = 0; k < stars.length; k++) {
        var dx = stars[k].home.x - hx, dy = stars[k].home.y - hy;
        if (dx * dx + dy * dy < L.starGap * L.starGap) { ok = false; break; }
      }
      if (!ok) continue;
      var sc = rand(0.55, 0.95);
      var sb = centeredBitmap(sprites[stars.length % 3], sc);
      sb.x = hx; sb.y = hy;
      starLayer.addChild(sb);
      stars.push({ bmp: sb, home: { x: hx, y: hy }, scale: sc, phase: rand(0, 6.28),
                   state: 'sky', t: 0, dur: 0, p0: null, p1: null, p2: null, delay: 0 });
    }
    // fall order: from the far edges inwards feels natural
    var fallOrder = stars.slice().sort(function () { return Math.random() - 0.5; });

    // ---- jar hit area & hint ring
    var hint = new createjs.Shape();
    hint.graphics.setStrokeStyle(4).beginStroke('rgba(255,226,160,0.9)')
      .drawEllipse(-JAR.hitW / 2, -JAR.hitH / 2.4, JAR.hitW, JAR.hitH / 1.2);
    hint.x = JAR.x; hint.y = JAR.y + 10; hint.alpha = 0; hint.compositeOperation = 'lighter';
    root.addChild(hint);

    var jarHit = new createjs.Shape();
    jarHit.graphics.beginFill('rgba(0,0,0,0.01)')
      .drawRect(JAR.x - JAR.hitW / 2, JAR.y - JAR.hitH / 2, JAR.hitW, JAR.hitH);
    jarHit.cursor = 'pointer';
    root.addChild(jarHit);

    // ---- texts
    var TX = FOCUS_X, T = L.text;
    var line1 = makeText('The sky has lost its light.\nCan you bring the stars back?', T.q[1], '#fff4e0', true);
    line1.x = TX; line1.y = T.q[0]; line1.alpha = 0;
    var line2 = makeText(opts.hintText || 'Tap the jar to release the stars.', T.hint[1], '#ffd9a0', false);
    line2.x = TX; line2.y = T.hint[0]; line2.alpha = 0;
    var line3 = makeText('Sometimes, true love means\nlearning to let go.', T.end[1], '#fff4e0', true);
    line3.x = TX; line3.y = T.end[0]; line3.alpha = 0;
    root.addChild(line1, line2, line3);

    var replay = new createjs.Container();
    var rpBg = new createjs.Shape();
    rpBg.graphics.beginFill('rgba(30,20,70,0.55)').beginStroke('rgba(255,220,170,0.7)').setStrokeStyle(2)
      .drawRoundRect(-120, -34, 240, 68, 34);
    var rpTx = makeText('↺  Replay', 32, '#fff1d6', false); rpTx.y = -20; rpTx.shadow = null;
    replay.addChild(rpBg, rpTx);
    replay.x = TX; replay.y = T.replay; replay.alpha = 0; replay.cursor = 'pointer'; replay.mouseEnabled = false;
    root.addChild(replay);

    // ---- intro overlay (also unlocks audio on mobile)
    var intro = new createjs.Container();
    var introBg = new createjs.Shape();
    introBg.graphics.beginFill('rgba(14,9,38,0.55)').drawRect(0, 0, W, H);
    var title = makeText('The Girl Who\nCollected Stars', T.title[1], '#fff4e0', true);
    title.x = TX; title.y = T.title[0];
    var tapStart = makeText('✦  Tap to begin  ✦', T.start[1], '#ffd9a0', false);
    tapStart.x = TX; tapStart.y = T.start[0];
    intro.addChild(introBg, title, tapStart);
    intro.cursor = 'pointer';
    root.addChild(intro);
    if (!L.intro) intro.visible = false;

    // ---- particles
    var parts = [];
    function spawn(x, y, opt) {
      var spr = opt.sprite || dotWarm;
      var b = centeredBitmap(spr, opt.scale || 0.5);
      b.x = x; b.y = y;
      fx.addChild(b);
      parts.push({ bmp: b, vx: opt.vx || 0, vy: opt.vy || 0, life: opt.life || 0.8, age: 0,
                   s0: opt.scale || 0.5, grow: opt.grow || 0, a0: opt.alpha == null ? 1 : opt.alpha });
    }
    function burst(x, y, n, power, sprite) {
      for (var i = 0; i < n; i++) {
        var a = rand(0, 6.28), v = rand(0.3, 1) * power;
        spawn(x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.5, 1.0),
                      scale: rand(0.25, 0.6), sprite: sprite });
      }
    }
    function ring(x, y) {
      spawn(x, y, { sprite: dotWarm, scale: 1.2, grow: 9, life: 0.55, alpha: 0.9 });
    }

    // ---- state
    var S = { phase: 'intro', time: 0, t: 0, collected: 0, released: 0, nextIdx: 0,
              darkness: 0, glowLevel: 0.18 };

    function resetStory() {
      S.phase = 'calm'; S.t = 0; S.collected = 0; S.released = 0; S.nextIdx = 0;
      stars.forEach(function (s) {
        s.state = 'sky'; s.bmp.visible = true; s.bmp.x = s.home.x; s.bmp.y = s.home.y;
        s.bmp.scaleX = s.bmp.scaleY = s.scale; s.bmp.alpha = 1;
      });
      fallOrder = stars.slice().sort(function () { return Math.random() - 0.5; });
      line1.alpha = line2.alpha = line3.alpha = 0;
      replay.alpha = 0; replay.mouseEnabled = false; hint.alpha = 0;
    }

    intro.on('click', function () {
      if (S.phase !== 'intro') return;
      audio.start();
      createjs.Tween.get(intro).to({ alpha: 0 }, 900).call(function () { intro.visible = false; });
      resetStory();
    });

    function startRelease() {
      if (S.phase !== 'waitTap') return;
      S.phase = 'release'; S.t = 0;
      createjs.Tween.get(line1, { override: true }).to({ alpha: 0 }, 700);
      createjs.Tween.get(line2, { override: true }).to({ alpha: 0 }, 500);
      createjs.Tween.get(hint, { override: true }).to({ alpha: 0 }, 400);
      ring(JAR.mouthX, JAR.mouthY);
      burst(JAR.mouthX, JAR.mouthY, 30, 260, dotWarm);
      audio.sfx('release', 0.8);
      var order = stars.slice().sort(function (a, b) { return a.home.y - b.home.y; });
      order.forEach(function (s, i) {
        s.state = 'rising'; s.t = 0; s.delay = 0.25 + i * TIMING.releaseInterval;
        s.dur = TIMING.riseDur * rand(0.9, 1.15);
        s.p0 = { x: JAR.mouthX + rand(-20, 20), y: JAR.mouthY };
        s.p2 = s.home;
        s.p1 = { x: JAR.mouthX + (s.home.x - JAR.mouthX) * rand(0.2, 0.6) + rand(-90, 90),
                 y: Math.min(JAR.mouthY, s.home.y) - rand(220, 420) };
        s.bmp.visible = false;
      });
    }
    jarHit.on('click', startRelease);
    hint.on('click', startRelease);

    replay.on('click', function () {
      if (S.phase !== 'end') return;
      createjs.Tween.get(line3, { override: true }).to({ alpha: 0 }, 500);
      createjs.Tween.get(replay, { override: true }).to({ alpha: 0 }, 500).call(resetStory);
      replay.mouseEnabled = false;
    });

    // ---- per-frame update
    function update(dt) {
      S.time += dt; S.t += dt;
      var i, s;

      if (S.phase === 'calm' && S.t > TIMING.calm) { S.phase = 'collect'; S.t = 0; }

      if (S.phase === 'collect') {
        // launch stars one by one
        while (S.nextIdx < fallOrder.length && S.t >= S.nextIdx * TIMING.starInterval) {
          s = fallOrder[S.nextIdx++];
          s.state = 'falling'; s.t = 0; s.dur = TIMING.fallDur * rand(0.85, 1.15);
          s.p0 = { x: s.home.x, y: s.home.y };
          s.p2 = { x: JAR.mouthX + rand(-25, 25), y: JAR.mouthY + 8 };
          s.p1 = { x: s.home.x + (s.p2.x - s.home.x) * 0.35 + rand(-160, 160),
                   y: Math.min(s.home.y, s.p2.y) - rand(60, 220) };
        }
        if (S.collected >= stars.length) { S.phase = 'dark'; S.t = 0; }
      }

      if (S.phase === 'dark' && S.t > TIMING.afterDark) {
        S.phase = 'waitTap'; S.t = 0;
        createjs.Tween.get(line1, { override: true }).to({ alpha: 1 }, 1400);
        createjs.Tween.get(line2, { override: true }).wait(TIMING.hintDelay * 1000).to({ alpha: 1 }, 900);
      }

      if (S.phase === 'waitTap') {
        if (S.t > TIMING.hintDelay) {
          var p = (Math.sin(S.time * 3) + 1) / 2;
          hint.alpha = 0.35 + p * 0.55;
          hint.scaleX = hint.scaleY = 1 + p * 0.06;
        }
      }

      if (S.phase === 'release' && S.released >= stars.length) {
        S.phase = 'endWait'; S.t = 0;
      }
      if (S.phase === 'endWait' && S.t > TIMING.endDelay) {
        S.phase = 'end'; S.t = 0;
        createjs.Tween.get(line3, { override: true }).to({ alpha: 1 }, 1800);
        createjs.Tween.get(replay, { override: true }).wait(2200).to({ alpha: 1 }, 800)
          .call(function () { replay.mouseEnabled = true; });
      }

      // stars
      for (i = 0; i < stars.length; i++) {
        s = stars[i];
        var tw = Math.sin(S.time * 2.2 + s.phase);
        if (s.state === 'sky') {
          s.bmp.visible = true;
          s.bmp.scaleX = s.bmp.scaleY = s.scale * (1 + tw * 0.08);
          s.bmp.alpha = 0.82 + tw * 0.18;
          s.bmp.rotation = tw * 4;
        } else if (s.state === 'falling') {
          s.t += dt;
          var u = clamp01(s.t / s.dur), e = easeInOut(u), pos = bez(s.p0, s.p1, s.p2, e);
          s.bmp.x = pos.x; s.bmp.y = pos.y;
          s.bmp.scaleX = s.bmp.scaleY = s.scale * (1 - 0.55 * e);
          s.bmp.rotation += dt * 220;
          if (Math.random() < 0.9) spawn(pos.x + rand(-4, 4), pos.y + rand(-4, 4),
            { life: rand(0.45, 0.9), scale: rand(0.2, 0.45), vy: rand(-10, 25), vx: rand(-12, 12),
              sprite: Math.random() < 0.3 ? dotPink : dotWarm });
          if (u >= 1) {
            s.state = 'inJar'; s.bmp.visible = false;
            S.collected++;
            ring(JAR.mouthX, JAR.mouthY + 30);
            burst(JAR.mouthX, JAR.mouthY + 30, 10, 90, dotWarm);
            audio.sfx('collect', 0.35, 120);
          }
        } else if (s.state === 'rising') {
          s.t += dt;
          if (s.t < s.delay) continue;
          var v = clamp01((s.t - s.delay) / s.dur), f = easeOut(v), q = bez(s.p0, s.p1, s.p2, f);
          s.bmp.visible = true;
          s.bmp.x = q.x; s.bmp.y = q.y;
          s.bmp.scaleX = s.bmp.scaleY = s.scale * (0.45 + 0.55 * f);
          s.bmp.rotation -= dt * 160;
          if (Math.random() < 0.95) spawn(q.x + rand(-5, 5), q.y + rand(-5, 5),
            { life: rand(0.5, 1.1), scale: rand(0.2, 0.5), vy: rand(10, 40), vx: rand(-15, 15),
              sprite: Math.random() < 0.35 ? dotPink : dotWarm });
          if (v >= 1) {
            s.state = 'sky'; S.released++;
            burst(s.home.x, s.home.y, 8, 70, dotWarm);
            ring(s.home.x, s.home.y);
          }
        }
      }

      // sky darkness & jar glow follow the story
      var targetDark, targetGlow;
      if (S.phase === 'release' || S.phase === 'endWait' || S.phase === 'end') {
        targetDark = 1 - S.released / stars.length;
        targetGlow = 0.18 + 0.82 * (1 - S.released / stars.length);
      } else if (S.phase === 'intro' || S.phase === 'calm') {
        targetDark = 0; targetGlow = 0.18;
      } else {
        targetDark = S.collected / stars.length;
        targetGlow = 0.18 + 0.82 * S.collected / stars.length;
      }
      S.darkness = approach(S.darkness, targetDark, 2.2, dt);
      S.glowLevel = approach(S.glowLevel, targetGlow, 3, dt);
      dark.alpha = easeInOut(clamp01(S.darkness));
      var gp = 1 + Math.sin(S.time * 2.4) * 0.04 * S.glowLevel;
      glow.alpha = S.glowLevel;
      glow.scaleX = glow.scaleY = (0.55 + 0.45 * S.glowLevel) * gp;

      // dust thins out as darkness grows
      for (i = 0; i < dustList.length; i++) {
        var dd = dustList[i];
        var visible = dd.order > S.darkness * 0.95 ? 1 : 0;
        var target = visible * dd.base * (0.55 + 0.45 * Math.sin(S.time * dd.speed + dd.phase));
        dd.bmp.alpha = approach(dd.bmp.alpha, target, 4, dt);
      }

      // particles
      for (i = parts.length - 1; i >= 0; i--) {
        var pt = parts[i];
        pt.age += dt;
        var lifeT = pt.age / pt.life;
        if (lifeT >= 1) { fx.removeChild(pt.bmp); parts.splice(i, 1); continue; }
        pt.bmp.x += pt.vx * dt; pt.bmp.y += pt.vy * dt;
        pt.vx *= 0.96; pt.vy *= 0.96;
        var sc2 = pt.s0 * (1 + pt.grow * lifeT) * (pt.grow ? 1 : (1 - lifeT * 0.6));
        pt.bmp.scaleX = pt.bmp.scaleY = sc2;
        pt.bmp.alpha = pt.a0 * (1 - lifeT);
      }

      if (S.phase === 'intro') {
        tapStart.alpha = 0.55 + 0.45 * Math.sin(S.time * 2.5);
      }
    }

    var tickHandler = createjs.Ticker.on('tick', function (evt) {
      // cap large gaps (tab switches) but keep real time on slower phones
      var dt = Math.min(0.1, (evt.delta || 16) / 1000);
      update(dt);
      if (opts.autoUpdateStage !== false && stage) stage.update(evt);
    });

    return {
      audio: audio,
      state: S,
      starCount: stars.length,
      skipToPrompt: function () { // debug helper
        if (S.phase === 'intro') { intro.visible = false; resetStory(); }
        stars.forEach(function (s) { s.state = 'inJar'; s.bmp.visible = false; });
        S.collected = stars.length; S.nextIdx = stars.length; S.phase = 'dark'; S.t = 0;
      },
      release: startRelease,
      // start without the intro overlay (AR mode starts when the poster is found)
      begin: function () {
        if (S.phase !== 'intro') return;
        intro.visible = false; audio.start(); resetStory();
      },
      replay: function () {
        if (S.phase !== 'end') return;
        replay.dispatchEvent('click');
      },
      destroy: function () { createjs.Ticker.off('tick', tickHandler); }
    };
  }

  global.StarStory = { LAYOUTS: LAYOUTS, ART: ART, SAFE_W: 760, init: init };
})(window);
