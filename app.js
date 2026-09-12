/* Kula Revise, Grade 10 content quiz engine.
   Offline first. Every answer is written to this device before anything else. */

(function () {
  'use strict';

  var DATA = window.QUIZ_DATA;
  var STORE_KEY = 'kula.g10.' + DATA.meta.id;
  var QUEUE_KEY = STORE_KEY + '.queue';
  var SB_URL = (window.KULA_SUPABASE_URL || '').replace(/\/$/, '');
  var SB_KEY = window.KULA_SUPABASE_ANON_KEY || '';
  var CLASS_CODE = window.KULA_CLASS_CODE || null;
  var SEND_NAMES = window.KULA_SEND_NAMES !== false;
  var ROWS_URL = SB_URL && SB_KEY
    ? SB_URL + '/rest/v1/quiz_rows?on_conflict=attempt_id,row_type,item_id,stage'
    : null;
  var RPC_URL = SB_URL && SB_KEY ? SB_URL + '/rest/v1/rpc/cohort_median' : null;
  var syncPaused = false;

  function sbHeaders(extra) {
    var h = {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
    return h;
  }

  var screen = document.getElementById('screen');
  var bar = document.getElementById('bar');
  var barStep = document.getElementById('bar-step');
  var barFill = document.getElementById('bar-fill');
  var barXp = document.getElementById('bar-xp');
  var barWords = document.getElementById('bar-words');
  var offlineFlag = document.getElementById('offline-flag');
  var sheet = document.getElementById('sheet');
  var sheetBody = document.getElementById('sheet-body');
  var sheetClose = document.getElementById('sheet-close');

  var TIER_ORDER = ['Recall', 'Understand', 'Apply'];
  var BAND_MIN_ITEMS = 4;

  /* ---------- storage ---------- */

  function readStore() {
    try { var raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
  }
  function writeStore(obj) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function readQueue() {
    try { var raw = localStorage.getItem(QUEUE_KEY); return raw ? JSON.parse(raw) : []; }
    catch (e) { return []; }
  }
  function writeQueue(rows) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(rows)); } catch (e) {}
  }
  /* Supabase rejects a batch whose rows do not all carry the same keys, and a
     batch holds answers and confidence rows together. So every row is built
     from the same template, with null where a column does not apply. */
  var ROW_TEMPLATE = {
    quiz_id: null, attempt_id: null, attempt_no: null, row_type: null,
    learner_ref: null, first_name: null, surname: null, class_code: null,
    item_id: '', item_ref: null, tier: null, caps_level: null,
    marks_awarded: null, marks_available: null, chosen_option: null,
    guide_opened: null, stage: '', confidence: null, confidence_reason: null,
    answered_at: null, offline_when_answered: null
  };

  function fullRow(row) {
    var out = {};
    for (var k in ROW_TEMPLATE) {
      if (Object.prototype.hasOwnProperty.call(ROW_TEMPLATE, k)) {
        out[k] = (row[k] === undefined) ? ROW_TEMPLATE[k] : row[k];
      }
    }
    return out;
  }

  function queueRow(row) {
    var s = readStore();
    row.learner_ref = s.learnerRef || 'unknown';
    row.class_code = CLASS_CODE;
    if (SEND_NAMES) {
      row.first_name = s.firstName || null;
      row.surname = s.surname || null;
    }
    if (row.item_id === undefined) row.item_id = '';
    if (row.stage === undefined) row.stage = '';
    var q = readQueue();
    q.push(fullRow(row));
    writeQueue(q);
    trySync();
  }

  /* Rows go to the phone first and only then to Supabase. Nothing is cleared
     from the phone until the database has said yes. */
  function trySync() {
    if (!ROWS_URL || syncPaused || !navigator.onLine) return;
    var q = readQueue();
    if (!q.length) return;
    var sending = q.length;

    fetch(ROWS_URL, {
      method: 'POST',
      headers: sbHeaders({ 'Prefer': 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify(q)
    }).then(function (res) {
      if (res.ok) {
        var left = readQueue().slice(sending);
        writeQueue(left);
        fetchMedian();
        return;
      }
      /* 401, 403 or a bad row would fail on every retry and burn the
         learner's data. Stop for this session and keep the rows safe. */
      return res.text().then(function (body) {
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          syncPaused = true;
        }
        console.error('Kula sync failed, status ' + res.status + ': ' + body);
        throw new Error('sync ' + res.status);
      });
    }).catch(function () { /* rows stay on the phone for the next connection */ });
  }

  function fetchMedian() {
    if (!RPC_URL) return;
    fetch(RPC_URL, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({ p_quiz_id: DATA.meta.id, p_class_code: CLASS_CODE })
    }).then(function (res) { return res.ok ? res.json() : null; })
      .then(function (value) {
        if (typeof value === 'number') {
          var st = readStore();
          st.cohortMedian = value;
          writeStore(st);
        }
      }).catch(function () {});
  }

  function flagOffline() {
    offlineFlag.className = navigator.onLine ? 'offline-flag' : 'offline-flag on';
  }
  window.addEventListener('online', function () { flagOffline(); trySync(); });
  window.addEventListener('offline', flagOffline);

  /* ---------- who ---------- */

  function first() { return readStore().firstName || ''; }
  function withName(text, fallback) {
    var f = first();
    if (f) return text.replace(/\{name\}/g, f);
    return fallback;
  }
  function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  /* ---------- state ---------- */

  var state = null;
  var hookIndex = 0;

  function newAttempt() {
    var store = readStore();
    store.attempts = (store.attempts || 0) + 1;
    if (!store.learnerRef) store.learnerRef = 'L' + Math.random().toString(36).slice(2, 10);
    writeStore(store);
    state = {
      attemptId: DATA.meta.id + '.' + Date.now(),
      attemptNo: store.attempts,
      index: 0,
      shuffles: {},
      responses: {},
      streak: 0,
      bestStreak: 0,
      guidesOpened: {},
      wordsOpened: {},
      confidenceBefore: null,
      startedAt: new Date().toISOString()
    };
  }

  function shuffleFor(item) {
    if (state.shuffles[item.id]) return state.shuffles[item.id];
    var idx = item.options.map(function (_, i) { return i; });
    for (var i = idx.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    state.shuffles[item.id] = idx;
    return idx;
  }
  function marksAwarded() {
    var n = 0;
    for (var k in state.responses) {
      if (Object.prototype.hasOwnProperty.call(state.responses, k)) n += state.responses[k].marks_awarded;
    }
    return n;
  }
  function tierTotals(responses) {
    var out = {};
    TIER_ORDER.forEach(function (t) { out[t] = { awarded: 0, available: 0, items: 0 }; });
    for (var k in responses) {
      if (!Object.prototype.hasOwnProperty.call(responses, k)) continue;
      var r = responses[k];
      out[r.tier].awarded += r.marks_awarded;
      out[r.tier].available += r.marks_available;
      out[r.tier].items += 1;
    }
    return out;
  }
  function bandFor(a, b) {
    var pct = b ? (a / b) * 100 : 0;
    if (pct >= 80) return DATA.bands[3];
    if (pct >= 60) return DATA.bands[2];
    if (pct >= 40) return DATA.bands[1];
    return DATA.bands[0];
  }

  /* ---------- builders ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear() {
    while (screen.firstChild) screen.removeChild(screen.firstChild);
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  /* ---------- word meanings ---------- */

  var TERMS = Object.keys(DATA.glossary).sort(function (a, b) { return b.length - a.length; });

  function openWord(term) {
    var def = DATA.glossary[term];
    if (!def) return;
    if (state) state.wordsOpened[term] = true;
    while (sheetBody.firstChild) sheetBody.removeChild(sheetBody.firstChild);
    sheetBody.appendChild(el('h3', null, term));
    sheetBody.appendChild(el('p', null, def));
    sheet.className = 'sheet open';
  }
  function closeSheet() { sheet.className = 'sheet'; }
  sheetClose.addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });

  /* Writes text into a node and turns the first mention of each known word
     into something the learner can tap for a plain meaning. */
  function say(node, text) {
    var used = {};
    var remaining = String(text);
    var guard = 0;
    while (remaining.length && guard < 500) {
      guard++;
      var bestAt = -1, bestTerm = null;
      for (var i = 0; i < TERMS.length; i++) {
        var term = TERMS[i];
        if (used[term.toLowerCase()]) continue;
        var re = new RegExp('(^|[^A-Za-z])(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![A-Za-z])', 'i');
        var m = re.exec(remaining);
        if (!m) continue;
        var at = m.index + m[1].length;
        if (bestAt === -1 || at < bestAt) { bestAt = at; bestTerm = term; }
      }
      if (bestTerm === null) { node.appendChild(document.createTextNode(remaining)); break; }
      var shown = remaining.substr(bestAt, bestTerm.length);
      used[bestTerm.toLowerCase()] = true;
      if (bestAt > 0) node.appendChild(document.createTextNode(remaining.slice(0, bestAt)));
      node.appendChild(wordButton(shown, bestTerm));
      remaining = remaining.slice(bestAt + bestTerm.length);
    }
    return node;
  }
  function wordButton(shown, term, extra) {
    var b = el('button', 'word' + (extra ? ' ' + extra : ''), shown);
    b.setAttribute('aria-label', 'What does ' + shown + ' mean?');
    b.addEventListener('click', function () { openWord(term); });
    return b;
  }
  function para(text, cls) { return say(el('p', cls || null), text); }

  function updateBar(step, total) {
    bar.className = 'bar';
    barStep.textContent = step + ' of ' + total;
    barFill.style.width = (step / total) * 100 + '%';
    barXp.textContent = marksAwarded() + ' XP';
  }

  barWords.addEventListener('click', function () {
    while (sheetBody.firstChild) sheetBody.removeChild(sheetBody.firstChild);
    sheetBody.appendChild(el('h3', null, 'Words'));
    sheetBody.appendChild(wordList(Object.keys(DATA.glossary)));
    sheet.className = 'sheet open';
  });

  /* A plain list. Tap a word and its meaning opens underneath it. */
  function wordList(terms) {
    var list = el('div', 'glosslist');
    terms.forEach(function (term) {
      var row = el('div', 'gloss');
      var b = el('button', 'gloss-term');
      b.appendChild(el('span', null, term));
      b.appendChild(el('span', 'gloss-sign', '+'));
      var def = el('p', 'gloss-def hide', DATA.glossary[term]);
      b.addEventListener('click', function () {
        var open = def.className.indexOf('hide') === -1;
        def.className = open ? 'gloss-def hide' : 'gloss-def';
        b.className = open ? 'gloss-term' : 'gloss-term on';
        b.lastChild.textContent = open ? '+' : '\u2212';
        if (state && !open) state.wordsOpened[term] = true;
      });
      row.appendChild(b);
      row.appendChild(def);
      list.appendChild(row);
    });
    return list;
  }

  /* ---------- the picture ---------- */

  function heroSvg() {
    var d = el('div', 'hero');
    d.innerHTML =
      '<svg viewBox="0 0 360 150" role="img" aria-label="A seam of gold running through dark rock">' +
      '<defs>' +
      '<linearGradient id="gseam" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0%" stop-color="#8A5A00"/><stop offset="50%" stop-color="#FFD770"/>' +
      '<stop offset="100%" stop-color="#8A5A00"/></linearGradient>' +
      '<linearGradient id="gshine" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0%" stop-color="#FFB020" stop-opacity="0"/>' +
      '<stop offset="45%" stop-color="#FFF4D6" stop-opacity="1"/>' +
      '<stop offset="100%" stop-color="#FFB020" stop-opacity="0"/></linearGradient>' +
      '</defs>' +
      '<rect width="360" height="150" fill="#0B0F14"/>' +
      '<g stroke="#1B232C" stroke-width="1" fill="none">' +
      '<path d="M0 34 L360 22 M0 68 L360 60 M0 106 L360 98 M0 138 L360 132"/>' +
      '<path d="M58 0 L48 150 M148 0 L138 150 M242 0 L252 150 M320 0 L330 150"/>' +
      '</g>' +
      '<path class="seam" d="M-6 98 L52 86 L96 94 L150 72 L206 80 L258 60 L312 68 L366 48" ' +
      'fill="none" stroke="url(#gseam)" stroke-width="7" stroke-linecap="round"/>' +
      '<path class="seam-shine" d="M-6 98 L52 86 L96 94 L150 72 L206 80 L258 60 L312 68 L366 48" ' +
      'fill="none" stroke="url(#gshine)" stroke-width="3" stroke-linecap="round"/>' +
      '<circle class="fleck f1" cx="88" cy="120" r="2.5" fill="#FFD770"/>' +
      '<circle class="fleck f2" cx="196" cy="128" r="2" fill="#FFD770"/>' +
      '<circle class="fleck f3" cx="288" cy="114" r="2.5" fill="#FFD770"/>' +
      '<circle class="fleck f4" cx="132" cy="40" r="2" fill="#FFD770"/>' +
      '</svg>';
    return d;
  }

  /* ---------- screens ---------- */

  function renderStart() {
    clear();
    bar.className = 'bar hide';
    var store = readStore();

    var c = el('div', 'card card-hero');
    c.appendChild(heroSvg());
    var pad = el('div', 'hero-pad');
    pad.appendChild(el('div', 'eyebrow', 'Kula Revise'));
    pad.appendChild(el('h1', null, DATA.meta.title));
    pad.appendChild(el('p', 'lead', DATA.meta.welcome));
    if (store.best) {
      pad.appendChild(el('p', null, withName('Welcome back, {name}. Your best so far is ' + store.best + ' out of ' + DATA.meta.total_marks + '.',
        'Your best so far is ' + store.best + ' out of ' + DATA.meta.total_marks + '.')));
    }
    var btn = el('button', 'btn', store.best ? 'Go again' : 'Start');
    btn.addEventListener('click', function () { newAttempt(); renderName(); });
    pad.appendChild(btn);
    c.appendChild(pad);
    screen.appendChild(c);
  }

  function renderName() {
    clear();
    bar.className = 'bar hide';
    var sc = DATA.name_screen;
    var store = readStore();

    var c = el('div', 'card');
    c.appendChild(el('h2', null, sc.title));
    c.appendChild(el('p', 'lead', sc.intro));

    var i1 = field(c, sc.first_label, 'given-name', store.firstName || '');
    var i2 = field(c, sc.surname_label, 'family-name', store.surname || '');

    var hint = el('p', 'hint', sc.wait);
    var go = el('button', 'btn btn-off', 'Next');
    go.disabled = true;

    function checkReady() {
      var ready = i1.value.trim().length > 0 && i2.value.trim().length > 0;
      go.disabled = !ready;
      go.className = ready ? 'btn' : 'btn btn-off';
      hint.className = ready ? 'hint hide' : 'hint';
    }
    i1.addEventListener('input', checkReady);
    i2.addEventListener('input', checkReady);

    go.addEventListener('click', function () {
      if (go.disabled) return;
      var st = readStore();
      st.firstName = i1.value.trim().slice(0, 40);
      st.surname = i2.value.trim().slice(0, 40);
      writeStore(st);
      renderConfidence('before');
    });
    c.appendChild(hint);
    c.appendChild(go);
    screen.appendChild(c);
    checkReady();
  }

  function field(parent, label, autocomplete, value) {
    var l = el('label', 'field');
    l.appendChild(el('span', null, label));
    var i = document.createElement('input');
    i.type = 'text';
    i.setAttribute('autocomplete', autocomplete);
    i.value = value;
    l.appendChild(i);
    parent.appendChild(l);
    return i;
  }

  function renderConfidence(stage) {
    clear();
    bar.className = 'bar hide';
    var cfg = DATA.confidence[stage];

    var c = el('div', 'card');
    c.appendChild(el('div', 'eyebrow', stage === 'before' ? 'Before you begin' : 'One last thing'));
    c.appendChild(el('h2', null, withName('{name}, ' + lower(cfg.title), cfg.title)));
    c.appendChild(el('p', null, cfg.prompt));
    c.appendChild(say(el('div', 'quote'), cfg.topic));

    var picked = null;
    var row = el('div', 'scale');
    DATA.confidence.scale.forEach(function (label, i) {
      var b = el('button', 'scale-btn');
      b.appendChild(el('span', 'scale-dot', String(i + 1)));
      b.appendChild(el('span', null, label));
      b.addEventListener('click', function () {
        picked = i + 1;
        for (var k = 0; k < row.children.length; k++) row.children[k].className = 'scale-btn';
        b.className = 'scale-btn on';
        go.disabled = false;
        go.className = 'btn';
      });
      row.appendChild(b);
    });
    c.appendChild(row);

    c.appendChild(el('p', 'lead', cfg.reason_prompt));
    var ta = document.createElement('textarea');
    ta.rows = 2;
    ta.className = 'reason';
    c.appendChild(ta);

    var go = el('button', 'btn btn-off', 'Carry on');
    go.disabled = true;
    go.addEventListener('click', function () {
      if (!picked) return;
      if (stage === 'before') state.confidenceBefore = picked;
      queueRow({
        quiz_id: DATA.meta.id,
        attempt_id: state.attemptId,
        attempt_no: state.attemptNo,
        row_type: 'confidence',
        stage: stage,
        confidence: picked,
        confidence_reason: (ta.value || '').trim().slice(0, 400),
        answered_at: new Date().toISOString(),
        offline_when_answered: !navigator.onLine
      });
      if (stage === 'before') { hookIndex = 0; renderHookIntro(); }
      else renderResults();
    });
    c.appendChild(go);
    screen.appendChild(c);
  }

  function renderHookIntro() {
    clear();
    bar.className = 'bar hide';
    var h = DATA.hook;

    var c = el('div', 'card card-hero');
    c.appendChild(heroSvg());
    var pad = el('div', 'hero-pad');
    pad.appendChild(el('div', 'eyebrow', h.eyebrow));
    pad.appendChild(el('h2', null, h.title));
    c.appendChild(pad);
    screen.appendChild(c);

    var b = el('div', 'card');
    h.scenario.forEach(function (p) { b.appendChild(el('p', null, p)); });
    b.appendChild(el('p', 'lead', 'Three quick questions first. These are not marked.'));
    var go = el('button', 'btn', 'Ask me');
    go.addEventListener('click', function () { hookIndex = 0; renderHookQuestion(); });
    b.appendChild(go);
    screen.appendChild(b);
  }

  function renderHookQuestion() {
    clear();
    bar.className = 'bar hide';
    var h = DATA.hook;
    var q = h.questions[hookIndex];

    var c = el('div', 'card');
    c.appendChild(el('div', 'eyebrow', withName('What do you think, {name}?', 'What do you think?')));
    c.appendChild(el('p', 'qtext', q.prompt));

    var list = el('div', 'opts');
    var nodes = [];
    q.options.forEach(function (o) {
      var b = el('button', 'opt');
      var mk = el('span', 'mark', '');
      b.appendChild(mk);
      b.appendChild(el('span', null, o.text));
      b.addEventListener('click', function () {
        for (var i = 0; i < nodes.length; i++) nodes[i].disabled = true;
        b.className = 'opt picked';
        mk.textContent = '\u2022';
        var note = el('div', 'verdict plain');
        note.appendChild(el('p', null, o.note));
        c.appendChild(note);
        var last = hookIndex + 1 >= h.questions.length;
        var next = el('button', 'btn', last ? 'So what has this got to do with History?' : 'Next one');
        next.addEventListener('click', function () {
          if (last) return renderTurn();
          hookIndex++;
          renderHookQuestion();
        });
        c.appendChild(next);
      });
      nodes.push(b);
      list.appendChild(b);
    });
    c.appendChild(list);
    screen.appendChild(c);
  }

  function renderTurn() {
    clear();
    bar.className = 'bar hide';
    var t = DATA.hook.turn;
    var c = el('div', 'card card-turn');
    c.appendChild(el('div', 'eyebrow', 'Here it is'));
    c.appendChild(el('h2', null, t.title));
    t.paras.forEach(function (p, i) {
      if (i === t.paras.length - 1) c.appendChild(para(withName('{name}, ' + lower(p), p)));
      else c.appendChild(para(p));
    });
    var go = el('button', 'btn', 'Show me the words I need');
    go.addEventListener('click', renderVocab);
    c.appendChild(go);
    screen.appendChild(c);
  }

  function renderVocab() {
    clear();
    bar.className = 'bar hide';
    var v = DATA.vocab;
    var c = el('div', 'card');
    c.appendChild(el('div', 'eyebrow', 'Words first'));
    c.appendChild(el('h2', null, v.title));
    c.appendChild(el('p', null, v.intro));
    c.appendChild(wordList(v.terms));
    c.appendChild(el('p', 'lead', v.note));
    var go = el('button', 'btn', 'Start Part One');
    go.addEventListener('click', function () { renderSection(DATA.sections[0]); });
    c.appendChild(go);
    screen.appendChild(c);
  }

  function renderSection(section) {
    clear();
    bar.className = 'bar hide';
    var c = el('div', 'card');
    c.appendChild(el('div', 'eyebrow', withName('Over to you, {name}', 'Over to you')));
    c.appendChild(el('h2', null, section.title));
    c.appendChild(para(section.intro));
    var btn = el('button', 'btn', 'Begin');
    btn.addEventListener('click', renderItem);
    c.appendChild(btn);
    screen.appendChild(c);
  }

  function renderItem() {
    var item = DATA.items[state.index];
    if (!item) return renderConfidence('after');

    clear();
    updateBar(state.index + 1, DATA.items.length);

    var tier = DATA.tiers[item.tier];
    var c = el('div', 'card');

    var meta = el('div', 'qmeta');
    meta.appendChild(el('span', 'qnum', 'Question ' + (state.index + 1)));
    meta.appendChild(el('span', 'qmarks', item.marks + (item.marks === 1 ? ' mark' : ' marks')));
    c.appendChild(meta);

    if (item.stimulus) {
      var box = el('div', 'stimulus');
      box.appendChild(el('div', 'stimulus-tag', 'Read this answer'));
      box.appendChild(say(el('p'), item.stimulus));
      c.appendChild(box);
    }
    c.appendChild(say(el('p', 'qtext'), item.prompt));

    var guideBtn = el('button', 'guide-btn', 'Help with this question');
    var guideBox = el('div', 'guide-box hide');
    guideBox.appendChild(el('h3', null, tier.guide_title));
    var ul = document.createElement('ul');
    tier.guide.forEach(function (line) { ul.appendChild(el('li', null, line)); });
    guideBox.appendChild(ul);
    guideBtn.addEventListener('click', function () {
      var open = guideBox.className.indexOf('hide') === -1;
      guideBox.className = open ? 'guide-box hide' : 'guide-box';
      guideBtn.textContent = open ? 'Help with this question' : 'Close';
      state.guidesOpened[item.id] = true;
    });
    c.appendChild(guideBtn);
    c.appendChild(guideBox);

    var order = shuffleFor(item);
    var list = el('div', 'opts');
    var buttons = [];
    order.forEach(function (origIndex) {
      var b = el('button', 'opt');
      var m = el('span', 'mark', '');
      b.appendChild(m);
      b.appendChild(el('span', null, item.options[origIndex]));
      b.addEventListener('click', function () { answer(origIndex); });
      buttons.push({ node: b, mark: m, orig: origIndex });
      list.appendChild(b);
    });
    c.appendChild(list);
    screen.appendChild(c);

    function answer(chosen) {
      var isRight = chosen === item.correct;
      var awarded = isRight ? item.marks : 0;

      state.responses[item.id] = {
        item_id: item.id, item_ref: item.item_ref, tier: item.tier,
        caps_level: item.caps_level, marks_awarded: awarded,
        marks_available: item.marks, correct: isRight
      };
      queueRow({
        quiz_id: DATA.meta.id,
        attempt_id: state.attemptId,
        attempt_no: state.attemptNo,
        row_type: 'response',
        item_id: item.id,
        item_ref: item.item_ref,
        tier: item.tier,
        caps_level: item.caps_level,
        marks_awarded: awarded,
        marks_available: item.marks,
        chosen_option: chosen,
        guide_opened: !!state.guidesOpened[item.id],
        answered_at: new Date().toISOString(),
        offline_when_answered: !navigator.onLine
      });

      if (isRight) {
        state.streak += 1;
        if (state.streak > state.bestStreak) state.bestStreak = state.streak;
      } else {
        state.streak = 0;
      }

      buttons.forEach(function (b) {
        b.node.disabled = true;
        if (b.orig === item.correct) { b.node.className = 'opt right'; b.mark.textContent = '\u2713'; }
        else if (b.orig === chosen) { b.node.className = 'opt wrong'; b.mark.textContent = '\u2715'; }
      });

      var v = el('div', 'verdict ' + (isRight ? 'right' : 'wrong'));
      var hd = el('div', 'verdict-hd');
      hd.appendChild(el('span', null, isRight ? '\u2713' : '\u2715'));
      var head = isRight ? 'Right' : 'Not right';
      if (isRight && first() && state.index % 4 === 0) head = 'Right, ' + first();
      hd.appendChild(el('span', null, head));
      v.appendChild(hd);
      v.appendChild(say(el('p'), item.feedback));
      c.appendChild(v);

      if (isRight && state.streak >= 3) {
        c.appendChild(el('div', 'streak', state.streak + ' right in a row.'));
      }

      var next = DATA.items[state.index + 1];
      var btn = el('button', 'btn', next ? 'Next question' : 'Nearly done');
      btn.addEventListener('click', function () {
        state.index += 1;
        if (!next) return renderConfidence('after');
        if (next.section !== item.section) {
          var sec = DATA.sections.filter(function (s) { return s.id === next.section; })[0];
          return renderSection(sec);
        }
        renderItem();
      });
      c.appendChild(btn);
      if (v.scrollIntoView) v.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderResults() {
    clear();
    bar.className = 'bar hide';

    var awarded = marksAwarded();
    var available = DATA.meta.total_marks;
    var pct = (awarded / available) * 100;

    var store = readStore();
    if (!store.first) store.first = awarded;
    if (!store.best || awarded > store.best) store.best = awarded;
    writeStore(store);
    trySync();

    var c = el('div', 'card');
    c.appendChild(el('div', 'eyebrow', 'Attempt ' + state.attemptNo));
    c.appendChild(el('h2', null, withName('{name}, you scored ' + awarded + ' out of ' + available,
      'You scored ' + awarded + ' out of ' + available)));

    var track = el('div', 'goldbar');
    var fill = el('div', 'goldbar-fill');
    track.appendChild(fill);
    c.appendChild(track);
    setTimeout(function () { fill.style.width = pct + '%'; }, 80);

    if (store.best > awarded) {
      c.appendChild(el('p', 'lead', 'Your best is still ' + store.best + '. Both are kept.'));
    } else if (state.attemptNo > 1) {
      c.appendChild(el('p', 'lead', 'That is your best so far. Your first try was ' + store.first + '.'));
    }
    if (typeof store.cohortMedian === 'number') {
      c.appendChild(el('p', 'lead', 'The middle score in your group is ' + store.cohortMedian + '. No names are shown, not yours and not anyone else\u2019s.'));
    }
    if (state.bestStreak >= 3) {
      c.appendChild(el('div', 'streak', 'Longest run of correct answers: ' + state.bestStreak + '.'));
    }
    screen.appendChild(c);

    var b = el('div', 'card');
    b.appendChild(el('h3', null, DATA.results_heading));
    var totals = tierTotals(state.responses);
    TIER_ORDER.forEach(function (t) {
      var block = el('div', 'band-block');
      var row = el('div', 'band-row');
      var nameBox = el('div', 'band-name');
      nameBox.appendChild(el('strong', null, t));
      nameBox.appendChild(el('span', null, DATA.tiers[t].meaning));
      row.appendChild(nameBox);
      var enough = totals[t].items >= BAND_MIN_ITEMS;
      var band = enough ? bandFor(totals[t].awarded, totals[t].available) : null;
      row.appendChild(enough ? el('div', 'band-val', band)
        : el('div', 'locked', 'Answer ' + (BAND_MIN_ITEMS - totals[t].items) + ' more'));
      block.appendChild(row);
      b.appendChild(block);
    });
    screen.appendChild(b);

    var m = el('div', 'card');
    m.appendChild(el('h3', null, DATA.mta.heading));
    m.appendChild(el('p', null, DATA.mta.lead));
    var mb = el('button', 'btn', 'Open it');
    mb.addEventListener('click', function () { renderMta(0); });
    m.appendChild(mb);

    var again = el('button', 'btn btn-quiet', 'Go again');
    again.addEventListener('click', function () { newAttempt(); renderSection(DATA.sections[0]); });
    m.appendChild(again);
    screen.appendChild(m);
  }

  function renderMta(which) {
    clear();
    bar.className = 'bar hide';
    var mta = DATA.mta;
    var ans = mta.answers[which];

    var intro = el('div', 'card');
    intro.appendChild(el('div', 'eyebrow', 'Now you mark it'));
    intro.appendChild(el('h2', null, ans.label));
    if (which === 0) intro.appendChild(el('p', null, mta.intro));
    intro.appendChild(el('p', 'lead', 'The question was: ' + mta.question));
    intro.appendChild(say(el('div', 'answer-box'), ans.text));
    screen.appendChild(intro);

    var work = el('div', 'card');
    work.appendChild(el('h3', null, 'Mark it against these six checks'));
    var done = 0;

    mta.criteria.forEach(function (question, i) {
      var v = ans.verdicts[i];
      var box = el('div', 'crit');
      box.appendChild(el('div', 'crit-q', (i + 1) + '. ' + question));
      var btns = el('div', 'crit-btns');
      var made = [];
      [['yes', 'Yes'], ['partial', 'Partly'], ['no', 'No']].forEach(function (ch) {
        var b = el('button', 'btn', ch[1]);
        b.addEventListener('click', function () {
          if (box.getAttribute('data-answered')) return;
          box.setAttribute('data-answered', '1');
          for (var k = 0; k < made.length; k++) made[k].disabled = true;
          b.className = 'btn ' + (ch[0] === v.correct ? 'picked-right' : 'picked-wrong');
          var line = el('div', 'crit-exp');
          line.appendChild(el('strong', null, (ch[0] === v.correct ? '\u2713 ' : '\u2715 ') +
            'Your teacher would say: ' + ({ yes: 'Yes', partial: 'Partly', no: 'No' })[v.correct] + '. '));
          line.appendChild(document.createTextNode(v.explain));
          box.appendChild(line);
          done += 1;
          if (done === mta.criteria.length) closeBtn.className = 'btn';
        });
        made.push(b);
        btns.appendChild(b);
      });
      box.appendChild(btns);
      work.appendChild(box);
    });

    var closeBtn = el('button', 'btn hide', which + 1 < mta.answers.length ? 'Next answer' : 'Finish');
    closeBtn.addEventListener('click', function () {
      if (which + 1 < mta.answers.length) return renderMta(which + 1);
      renderMtaEnd();
    });
    work.appendChild(closeBtn);
    screen.appendChild(work);
  }

  function renderMtaEnd() {
    clear();
    var c = el('div', 'card');
    c.appendChild(el('div', 'eyebrow', 'Done'));
    c.appendChild(el('h2', null, 'What separates the two answers'));
    c.appendChild(el('p', null, 'Both answers use real facts. Only one explains why those facts led to war.'));
    c.appendChild(el('p', null, withName('Facts earn some marks, {name}. Reasons earn the rest.',
      'Facts earn some marks. Reasons earn the rest.')));
    c.appendChild(el('p', null, 'When you write, put the reason in the sentence next to the fact.'));
    var b = el('button', 'btn', 'Back to my score');
    b.addEventListener('click', renderResults);
    c.appendChild(b);
    screen.appendChild(c);
  }

  /* ---------- boot ---------- */

  flagOffline();
  trySync();
  renderStart();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
