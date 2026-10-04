/* GeoAI 官网渲染 + 交互
   依赖 content.js（window.GEOAI_CONTENT）。纯静态，无构建。 */

(function () {
  'use strict';

  var root = document.documentElement;
  var C = window.GEOAI_CONTENT;
  var THEME_KEY = 'geoai-theme';
  var LANG_KEY = 'geoai-lang';

  var state = {
    lang: 'zh',
    theme: 'dark',
    activeTab: 0,
  };

  /* ─────────── 图标 ─────────── */

  var ICONS = {
    experience: '<path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5 12 21l9-4.5"/>',
    kit: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
    runtime: '<circle cx="12" cy="12" r="9"/><path d="m10 8.4 6 3.6-6 3.6V8.4Z"/>',
    bridge: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.3 10.8 7.4-4.3M8.3 13.2l7.4 4.3"/>',
    plug: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
    camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-2h7.2l1.2 2h1.7A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-8Z"/><circle cx="12" cy="12.5" r="3.5"/>',
    imagery: '<path d="m9 4 6 2 6-2v14l-6 2-6-2-6 2V6l6-2Z"/><path d="M9 4v14M15 6v14"/>',
    geojson: '<path d="m12 4 7 4v8l-7 4-7-4V8l7-4Z"/><circle cx="12" cy="4" r="1.4"/><circle cx="19" cy="8" r="1.4"/><circle cx="19" cy="16" r="1.4"/><circle cx="12" cy="20" r="1.4"/><circle cx="5" cy="16" r="1.4"/><circle cx="5" cy="8" r="1.4"/>',
    drawer: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>',
    measure: '<path d="M15.5 3 21 8.5 8.5 21 3 15.5 15.5 3Z"/><path d="m6.5 14.5 1.8 1.8M9.5 11.5l1.8 1.8M12.5 8.5l1.8 1.8M15.5 5.5l1.8 1.8"/>',
    overlay: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/>',
    terrain: '<path d="m3 19 6-11 4 6 2-3 6 8H3Z"/><circle cx="17" cy="6" r="2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><ellipse cx="12" cy="12" rx="4" ry="9"/>',
    book: '<path d="M6 3h11a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M8 3v18"/>',
    arrow: '<path d="M5 12h14m-6-7 7 7-7 7"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"/>',
  };

  function icon(name) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || '') +
      '</svg>'
    );
  }

  function logoMark() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="6.4"/>' +
      '<ellipse cx="12" cy="12" rx="10.2" ry="3.9" transform="rotate(22 12 12)" opacity="0.85"/>' +
      '<circle cx="18.4" cy="6.2" r="1.7" fill="currentColor" stroke="none"/>' +
      '</svg>'
    );
  }

  /* ─────────── 文本转义 ─────────── */

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ─────────── 轻量语法高亮 ─────────── */

  function hlJson(line) {
    var out = '';
    var re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([{}\[\],:])/g;
    var last = 0;
    var m;
    while ((m = re.exec(line))) {
      if (m.index > last) out += esc(line.slice(last, m.index));
      if (m[1] !== undefined) {
        if (m[2] !== undefined) out += '<span class="tk-key">' + esc(m[1]) + '</span>' + esc(m[2]);
        else out += '<span class="tk-str">' + esc(m[1]) + '</span>';
      } else if (m[3] !== undefined) {
        out += '<span class="tk-num">' + esc(m[3]) + '</span>';
      } else if (m[4] !== undefined) {
        out += '<span class="tk-key">' + esc(m[4]) + '</span>';
      } else if (m[5] !== undefined) {
        out += '<span class="tk-punc">' + esc(m[5]) + '</span>';
      }
      last = re.lastIndex;
    }
    if (last < line.length) out += esc(line.slice(last));
    return out;
  }

  function hlBash(line) {
    var hash = line.indexOf('#');
    var code = hash === -1 ? line : line.slice(0, hash);
    var comment = hash === -1 ? '' : line.slice(hash);
    var out = '';
    if (code.trim() === '') {
      out = esc(code);
    } else {
      var m = code.match(/^(\s*)(\S+)([\s\S]*)$/);
      out = esc(m[1]) + '<span class="tk-cmd">' + esc(m[2]) + '</span>' + esc(m[3]);
    }
    if (comment) out += '<span class="tk-cmt">' + esc(comment) + '</span>';
    return out;
  }

  function highlight(code, lang) {
    return code
      .split('\n')
      .map(function (line) {
        var h = lang === 'json' ? hlJson(line) : lang === 'bash' ? hlBash(line) : esc(line);
        return '<div class="code-line">' + (h || '&nbsp;') + '</div>';
      })
      .join('');
  }

  /* ─────────── 渲染 ─────────── */

  function T() {
    return C[state.lang];
  }

  function delay(i) {
    return ' style="transition-delay:' + (i % 3) * 70 + 'ms"';
  }

  function navHTML() {
    var n = T().nav;
    var links = n.links
      .map(function (l) {
        return '<a href="' + l.href + '">' + esc(l.label) + '</a>';
      })
      .join('');
    var themeIcon = state.theme === 'dark' ? 'sun' : 'moon';
    return (
      '<div class="wrap sc-nav-inner">' +
      '<a class="sc-brand" href="#top">' +
      '<span class="sc-mark">' +
      logoMark() +
      '</span>' +
      '<span class="sc-name"><b>' + esc(n.brand) + '</b><span class="sc-ver">' + esc(n.version) + '</span></span>' +
      '</a>' +
      '<div class="sc-links">' + links + '</div>' +
      '<div class="sc-actions">' +
      '<button class="sc-lang" id="langBtn" type="button" aria-label="Switch language">' + esc(n.langLabel) + '</button>' +
      '<button class="sc-icon-btn" id="themeBtn" type="button" title="' + esc(n.themeTitle) + '" aria-label="Toggle theme">' +
      icon(themeIcon) +
      '</button>' +
      '<a class="sc-cta" href="#quickstart">' + esc(n.cta) + '</a>' +
      '</div>' +
      '</div>'
    );
  }

  function heroHTML() {
    var h = T().hero;
    var desc = h.desc
      .map(function (seg) {
        return seg.hl ? '<em>' + esc(seg.t) + '</em>' : '<span>' + esc(seg.t) + '</span>';
      })
      .join('');
    var actions = h.actions
      .map(function (a) {
        var cls = a.primary ? 'btn btn-primary' : 'btn btn-ghost';
        return '<a class="' + cls + '" href="' + a.href + '">' + esc(a.label) + (a.primary ? icon('arrow') : '') + '</a>';
      })
      .join('');
    var stats = h.stats
      .map(function (s) {
        return '<div class="stat"><b>' + esc(s.num) + '</b><span>' + esc(s.lbl) + '</span></div>';
      })
      .join('');
    return (
      '<header class="hero" id="top">' +
      '<div class="hero-inner">' +
      '<span class="pill"><span class="pill-dot" aria-hidden="true"></span>' + esc(h.pill) + '</span>' +
      '<h1 class="hero-title">' + esc(h.titleA) + '<br/>' + esc(h.titleB) + '</h1>' +
      '<p class="hero-desc">' + desc + '</p>' +
      '<div class="hero-actions">' + actions + '</div>' +
      '<div class="hero-stats">' + stats + '</div>' +
      '</div>' +
      '</header>'
    );
  }

  function secHead(s) {
    return (
      '<div class="sec-head reveal">' +
      '<div class="eyebrow">' + esc(s.eyebrow) + '</div>' +
      '<h2 class="sec-title">' + esc(s.title) + '<span class="hl">' + esc(s.titleHl) + '</span></h2>' +
      '<p class="sec-desc">' + esc(s.desc) + '</p>' +
      '</div>'
    );
  }

  function painHTML() {
    var p = T().pain;
    var cols = { pain: '', solve: '' };
    p.items.forEach(function (it, i) {
      var cls = it.kind === 'solve' ? 'solve' : 'pain';
      cols[cls] +=
        '<div class="pain-card ' + cls + ' reveal"' + delay(i) + '>' +
        '<div class="pain-head"><span class="pain-ic">' + (cls === 'solve' ? '✓' : '✕') + '</span>' + esc(it.head) + '</div>' +
        '<p>' + esc(it.desc) + '</p>' +
        '</div>';
    });
    return (
      '<section id="pain"><div class="wrap">' + secHead(p) +
      '<div class="pain-grid">' +
      '<div class="pain-col">' + cols.pain + '</div>' +
      '<div class="pain-col">' + cols.solve + '</div>' +
      '</div></div></section>'
    );
  }

  function featuresHTML() {
    var f = T().features;
    var cards = f.items
      .map(function (it, i) {
        return (
          '<article class="feat reveal"' + delay(i) + '>' +
          '<div class="feat-ic">' + icon(it.icon) + '</div>' +
          '<h3>' + esc(it.title) + '</h3>' +
          '<p>' + esc(it.desc) + '</p>' +
          '<span class="tag">' + esc(it.tag) + '</span>' +
          '</article>'
        );
      })
      .join('');
    return (
      '<section id="features"><div class="wrap">' + secHead(f) +
      '<div class="grid-3">' + cards + '</div>' +
      '</div></section>'
    );
  }

  function flywheelHTML() {
    var f = T().flywheel;
    var steps = f.steps
      .map(function (s, i) {
        var arrow = i < f.steps.length - 1 ? '<span class="fw-arrow" aria-hidden="true">→</span>' : '';
        return (
          '<div class="fw-step reveal"' + delay(i) + '>' +
          '<div class="fw-num">' + (i + 1) + '</div>' +
          '<h4>' + esc(s.title) + '</h4>' +
          '<p>' + esc(s.desc) + '</p>' +
          arrow +
          '</div>'
        );
      })
      .join('');
    return (
      '<section id="flywheel" class="flywheel-section"><div class="wrap">' + secHead(f) +
      '<div class="flywheel">' + steps + '</div>' +
      '<div class="fw-loop">' + esc(f.loop) + '</div>' +
      '</div></section>'
    );
  }

  function archHTML() {
    var a = T().arch;
    var nodes = a.nodes
      .map(function (n, i) {
        var layer =
          '<div class="arch-layer' + (n.accent ? ' accent' : '') + '"><b>' + esc(n.name) + '</b><span>' + esc(n.sub) + '</span></div>';
        var arrow = i < a.nodes.length - 1 ? '<div class="arch-arrow">↓</div>' : '';
        return layer + arrow;
      })
      .join('');
    var legend = a.legend
      .map(function (l) {
        return '<span>' + esc(l) + '</span>';
      })
      .join('');
    return (
      '<section id="architecture"><div class="wrap">' + secHead(a) +
      '<div class="arch glass reveal">' + nodes +
      '<div class="arch-legend">' + legend + '</div>' +
      '</div></div></section>'
    );
  }

  function quickstartHTML() {
    var q = T().quickstart;
    var tabs = q.tabs
      .map(function (tb, i) {
        return (
          '<button class="tab' + (i === state.activeTab ? ' active' : '') + '" type="button" data-tab="' + i + '">' +
          esc(tb.label) +
          '</button>'
        );
      })
      .join('');
    return (
      '<section id="quickstart"><div class="wrap">' + secHead(q) +
      '<div class="tabs">' + tabs + '</div>' +
      '<div id="codeMount"></div>' +
      '<p class="sec-desc" style="text-align:center;font-size:13.5px;max-width:760px;margin:24px auto 0">' + esc(q.note) + '</p>' +
      '</div></section>'
    );
  }

  function renderCode() {
    var mount = document.getElementById('codeMount');
    if (!mount) return;
    var q = T().quickstart;
    var tab = q.tabs[state.activeTab] || q.tabs[0];
    var copyLabel = state.lang === 'zh' ? '复制' : 'Copy';
    mount.innerHTML =
      '<div class="code-block">' +
      '<div class="code-head">' +
      '<span class="code-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="code-file">' + esc(tab.file) + '</span>' +
      '<button class="code-copy" id="copyBtn" type="button">' + copyLabel + '</button>' +
      '</div>' +
      '<div class="code-body">' + highlight(tab.code, tab.lang) + '</div>' +
      '</div>';
    var btn = document.getElementById('copyBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        var text = tab.code;
        var done = function () {
          btn.textContent = state.lang === 'zh' ? '已复制 ✓' : 'Copied ✓';
          setTimeout(function () {
            btn.textContent = copyLabel;
          }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, done);
        } else {
          var ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
          } catch (e) {}
          document.body.removeChild(ta);
          done();
        }
      });
    }
  }

  function kitsHTML() {
    var k = T().kits;
    var badge = state.lang === 'zh' ? { ready: '可用', planned: '规划中' } : { ready: 'READY', planned: 'PLANNED' };
    var cards = k.items
      .map(function (it, i) {
        return (
          '<article class="kit reveal"' + delay(i) + '>' +
          '<div class="kit-top">' +
          '<span class="kit-ic">' + icon(it.icon) + '</span>' +
          '<div class="kit-title"><h3>' + esc(it.title) + '</h3>' +
          '<span class="badge ' + it.status + '">' + esc(badge[it.status] || it.status) + '</span></div>' +
          '</div>' +
          '<div class="kit-id">' + esc(it.id) + '</div>' +
          '<p style="margin-top:12px">' + esc(it.desc) + '</p>' +
          '<div class="kit-sig">' + esc(it.sig) + '</div>' +
          '</article>'
        );
      })
      .join('');
    return (
      '<section id="kits"><div class="wrap">' + secHead(k) +
      '<div class="kits-grid">' + cards + '</div>' +
      '</div></section>'
    );
  }

  function toolsHTML() {
    var t = T().tools;
    var items = t.items
      .map(function (it, i) {
        return (
          '<div class="tool reveal"' + delay(i) + '>' +
          '<code>' + esc(it.name) + '</code>' +
          '<span>' + esc(it.desc) + '</span>' +
          '</div>'
        );
      })
      .join('');
    return (
      '<section id="tools"><div class="wrap">' + secHead(t) +
      '<div class="tools">' + items + '</div>' +
      '</div></section>'
    );
  }

  function casesHTML() {
    var c = T().cases;
    var cards = c.items
      .map(function (it, i) {
        return (
          '<article class="case reveal"' + delay(i) + '>' +
          '<span class="case-ic">' + icon(it.icon) + '</span>' +
          '<h3>' + esc(it.title) + '</h3>' +
          '<p>' + esc(it.desc) + '</p>' +
          '</article>'
        );
      })
      .join('');
    return (
      '<section id="cases"><div class="wrap">' + secHead(c) +
      '<div class="grid-3">' + cards + '</div>' +
      '</div></section>'
    );
  }

  function roadmapHTML() {
    var r = T().roadmap;
    var items = r.items
      .map(function (it, i) {
        return (
          '<div class="tl-item reveal"' + delay(i) + '>' +
          '<div class="tl-ver">' + esc(it.ver) + '</div>' +
          '<div class="tl-title">' + esc(it.title) + '</div>' +
          '<div class="tl-desc">' + esc(it.desc) + '</div>' +
          '</div>'
        );
      })
      .join('');
    return (
      '<section id="roadmap"><div class="wrap">' + secHead(r) +
      '<div class="timeline">' + items + '</div>' +
      '</div></section>'
    );
  }

  function ctaHTML() {
    var c = T().cta;
    return (
      '<section class="cta-band" id="cta"><div class="wrap">' +
      '<h2 class="reveal">' + esc(c.titleA) + '<span class="hl">' + esc(c.titleHl) + '</span>' + esc(c.titleB) + '</h2>' +
      '<p class="reveal">' + esc(c.desc) + '</p>' +
      '<div class="cta-actions reveal">' +
      '<a class="btn btn-primary" href="' + c.primary.href + '"' + (c.primary.external ? ' target="_blank" rel="noreferrer"' : '') + '>' +
      esc(c.primary.label) + icon('arrow') + '</a>' +
      '<a class="btn btn-ghost" href="' + c.ghost.href + '">' + esc(c.ghost.label) + '</a>' +
      '</div></div></section>'
    );
  }

  function footerHTML() {
    var f = T().footer;
    var cols = f.cols
      .map(function (col) {
        var links = col.links
          .map(function (l) {
            return (
              '<a href="' + l.href + '"' + (l.external ? ' target="_blank" rel="noreferrer"' : '') + '>' + esc(l.label) + '</a>'
            );
          })
          .join('');
        return '<div class="sc-foot-col"><h4>' + esc(col.title) + '</h4>' + links + '</div>';
      })
      .join('');
    return (
      '<div class="wrap">' +
      '<div class="sc-foot-grid">' +
      '<div class="sc-foot-brand">' +
      '<a class="sc-brand" href="#top"><span class="sc-mark">' + logoMark() + '</span>' +
      '<span class="sc-name"><b>GeoAI</b></span></a>' +
      '<p>' + esc(f.tagline) + '</p>' +
      '</div>' +
      cols +
      '</div>' +
      '<div class="sc-foot-bottom"><span>' + esc(f.bottomLeft) + '</span><span>' + esc(f.bottomRight) + '</span></div>' +
      '<div class="sc-foot-disclaimer">' + esc(f.disclaimer) + '</div>' +
      '</div>'
    );
  }

  /* ─────────── 交互 ─────────── */

  function applyTheme(theme) {
    state.theme = theme;
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {}
  }

  function wireNav() {
    var themeBtn = document.getElementById('themeBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var next = state.theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        themeBtn.innerHTML = icon(next === 'dark' ? 'sun' : 'moon');
      });
    }
    var langBtn = document.getElementById('langBtn');
    if (langBtn) {
      langBtn.addEventListener('click', function () {
        state.lang = state.lang === 'zh' ? 'en' : 'zh';
        state.activeTab = 0;
        try {
          localStorage.setItem(LANG_KEY, state.lang);
        } catch (e) {}
        render();
      });
    }
  }

  function wireTabs() {
    var tabs = document.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function (btn) {
      btn.addEventListener('click', function () {
        state.activeTab = parseInt(btn.getAttribute('data-tab'), 10) || 0;
        Array.prototype.forEach.call(tabs, function (b) {
          b.classList.toggle('active', b === btn);
        });
        renderCode();
      });
    });
  }

  function reveal() {
    var els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(els, function (e) {
        e.classList.add('in');
      });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    Array.prototype.forEach.call(els, function (e) {
      io.observe(e);
    });
  }

  function render() {
    var tt = T();
    document.documentElement.setAttribute('lang', state.lang === 'zh' ? 'zh-CN' : 'en');
    document.title = tt.meta.title;

    document.getElementById('nav').innerHTML = navHTML();
    document.getElementById('app').innerHTML =
      heroHTML() +
      painHTML() +
      featuresHTML() +
      flywheelHTML() +
      archHTML() +
      quickstartHTML() +
      kitsHTML() +
      toolsHTML() +
      casesHTML() +
      roadmapHTML() +
      ctaHTML();
    document.getElementById('footer').innerHTML = footerHTML();

    renderCode();
    wireNav();
    wireTabs();
    reveal();
  }

  /* ─────────── 启动 ─────────── */

  try {
    var savedLang = localStorage.getItem(LANG_KEY);
    if (savedLang === 'en' || savedLang === 'zh') state.lang = savedLang;
    var savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') state.theme = savedTheme;
  } catch (e) {}
  applyTheme(state.theme);

  var nav = document.getElementById('nav');
  window.addEventListener(
    'scroll',
    function () {
      nav.classList.toggle('scrolled', window.scrollY > 8);
    },
    { passive: true }
  );

  render();
})();
