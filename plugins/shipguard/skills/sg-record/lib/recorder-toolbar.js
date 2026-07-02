/**
 * recorder-toolbar.js
 *
 * Injected into every page during ShipGuard macro recording via Playwright's
 * page.addScriptTag() (re-injected on each navigation by sg-record.mjs).
 * Captures user interactions and bridges them to the Node.js process
 * through window.__sgBridge().
 *
 * The CSS placeholder below is replaced at runtime by sg-record.mjs with
 * the actual contents of recorder-toolbar.css.
 */
(function () {
  /* ── Double-init guard (SPA navigation) ────────────────────── */
  if (window.__sgRecorderInit) return;
  window.__sgRecorderInit = true;

  /* ── Inject styles ─────────────────────────────────────────── */
  var style = document.createElement('style');
  style.textContent = '__CSS_PLACEHOLDER__';
  (document.head || document.documentElement).appendChild(style);

  /* ── State ─────────────────────────────────────────────────── */
  var steps = [];
  var paused = false;
  var checkMode = false;
  var stopped = false;
  var startTime = Date.now();
  var timerInterval = null;
  var lastUrl = location.href;

  // Restore from sessionStorage (SPA persistence)
  try {
    var saved = sessionStorage.getItem('__sgSteps');
    if (saved) steps = JSON.parse(saved);
    var savedTime = sessionStorage.getItem('__sgStartTime');
    if (savedTime) startTime = parseInt(savedTime, 10);
  } catch (_) { /* ignore */ }

  function persistSteps() {
    try {
      sessionStorage.setItem('__sgSteps', JSON.stringify(steps));
      sessionStorage.setItem('__sgStartTime', String(startTime));
    } catch (_) { /* ignore */ }
  }

  /* ── Bridge to Node.js ─────────────────────────────────────── */
  function bridge(event) {
    try {
      if (typeof window.__sgBridge === 'function') {
        window.__sgBridge(JSON.stringify(event));
      }
    } catch (_) { /* bridge may not exist yet */ }
  }

  /* ── DOM helper ────────────────────────────────────────────── */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = attrs[k];
        if (k === 'className') {
          el.className = v;
        } else if (k.startsWith('on') && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else {
          el.setAttribute(k, v);
        }
      }
    }
    if (children != null) {
      if (typeof children === 'string') {
        el.textContent = children;
      } else if (Array.isArray(children)) {
        for (var c = 0; c < children.length; c++) {
          if (children[c]) el.appendChild(children[c]);
        }
      }
    }
    return el;
  }

  /** Remove all children from an element (safe, no innerHTML). */
  function clearChildren(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  /* ── Toolbar DOM ───────────────────────────────────────────── */
  var recDot = h('span', { className: 'sg-rec-dot' });
  var titleEl = h('span', { className: 'sg-title' }, 'SG Record');
  var timerEl = h('span', { className: 'sg-timer', id: 'sg-timer' }, '00:00');
  var minimizeBtn = h('button', { className: 'sg-minimize', onClick: toggleMinimize }, '\u2015');

  var header = h('div', { className: 'sg-header' }, [recDot, titleEl, timerEl, minimizeBtn]);

  var stepList = h('div', { className: 'sg-steps', id: 'sg-steps' });

  var undoBtn = h('button', { className: 'sg-btn sg-btn-undo', onClick: undoStep }, '\u21A9 Undo');
  var checkBtn = h('button', {
    className: 'sg-btn sg-btn-check',
    id: 'sg-check-btn',
    onClick: toggleCheck
  }, '\u2714 Check');
  var pauseBtn = h('button', {
    className: 'sg-btn sg-btn-pause',
    id: 'sg-pause-btn',
    onClick: togglePause
  }, '\u23F8');
  var stopBtn = h('button', { className: 'sg-btn sg-btn-stop', onClick: stopRecording }, '\u25A0 Stop');

  var actions = h('div', { className: 'sg-actions' }, [undoBtn, checkBtn, pauseBtn, stopBtn]);

  var toolbar = h('div', { id: 'sg-recorder' }, [header, stepList, actions]);
  (document.body || document.documentElement).appendChild(toolbar);

  /* ── Timer ─────────────────────────────────────────────────── */
  function updateTimer() {
    var elapsed = Math.floor((Date.now() - startTime) / 1000);
    var mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    var ss = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = mm + ':' + ss;
  }
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);

  /* ── Step detail text ──────────────────────────────────────── */
  function stepDetail(step) {
    switch (step.type) {
      case 'open':
        return step.url || '';
      case 'click':
        return step.text || step.selector || '';
      case 'fill': {
        var label = step.text || step.selector || '';
        var val = (step.value || '').slice(0, 30);
        return label + ' \u2190 "' + val + '"';
      }
      case 'check': {
        var txt = (step.text || '').slice(0, 40);
        return '"' + txt + '"';
      }
      case 'upload':
        return (step.files && step.files[0]) || '';
      case 'select': {
        var lbl = step.text || step.selector || '';
        return lbl + ' \u2190 ' + (step.value || '');
      }
      default:
        return step.type;
    }
  }

  /* ── Render steps list ─────────────────────────────────────── */
  function renderSteps() {
    clearChildren(stepList);
    if (steps.length === 0) {
      stepList.appendChild(h('div', { className: 'sg-empty' }, 'Interact with the page to record steps...'));
    } else {
      steps.forEach(function (step, i) {
        var isCheck = step.type === 'check';
        var row = h('div', { className: 'sg-step' + (isCheck ? ' is-check' : '') }, [
          h('span', { className: 'sg-step-icon' }, '\u2713'),
          h('span', { className: 'sg-step-type' }, step.type),
          h('span', { className: 'sg-step-detail' }, stepDetail(step)),
          h('button', {
            className: 'sg-step-del',
            onClick: function () { deleteStep(i); }
          }, '\u2715')
        ]);
        stepList.appendChild(row);
      });
      stepList.scrollTop = stepList.scrollHeight;
    }
    persistSteps();
  }

  /* ── Step operations ───────────────────────────────────────── */
  function addStep(step) {
    if (paused || stopped) return;
    steps.push(step);
    renderSteps();
    bridge({ type: 'step', step: step });
  }

  function undoStep() {
    if (steps.length === 0) return;
    steps.pop();
    renderSteps();
    bridge({ type: 'undo', remaining: steps.length });
  }

  function deleteStep(index) {
    steps.splice(index, 1);
    renderSteps();
    bridge({ type: 'delete', index: index, remaining: steps.length });
  }

  /* ── Toolbar controls ──────────────────────────────────────── */
  function togglePause() {
    paused = !paused;
    pauseBtn.textContent = paused ? '\u25B6' : '\u23F8';
    if (paused) {
      recDot.classList.add('paused');
    } else {
      recDot.classList.remove('paused');
    }
    bridge({ type: paused ? 'pause' : 'resume' });
  }

  function toggleMinimize() {
    toolbar.classList.toggle('minimized');
  }

  /* ── Check mode ────────────────────────────────────────────── */
  var checkOverlay = null;
  var checkHighlight = null;

  function toggleCheck() {
    checkMode = !checkMode;
    if (checkMode) {
      checkBtn.classList.add('active');
      toolbar.classList.add('check-mode');
      enterCheckMode();
    } else {
      checkBtn.classList.remove('active');
      toolbar.classList.remove('check-mode');
      exitCheckMode();
    }
  }

  function enterCheckMode() {
    checkHighlight = h('div', { className: 'sg-check-highlight' });
    document.body.appendChild(checkHighlight);

    checkOverlay = h('div', { className: 'sg-check-overlay' });
    document.body.appendChild(checkOverlay);

    checkOverlay.addEventListener('mousemove', function (e) {
      // Temporarily hide overlay to find element underneath
      checkOverlay.style.pointerEvents = 'none';
      var target = document.elementFromPoint(e.clientX, e.clientY);
      checkOverlay.style.pointerEvents = '';

      if (!target || isToolbarElement(target)) {
        checkHighlight.style.display = 'none';
        return;
      }

      var rect = target.getBoundingClientRect();
      checkHighlight.style.display = '';
      checkHighlight.style.top = rect.top + 'px';
      checkHighlight.style.left = rect.left + 'px';
      checkHighlight.style.width = rect.width + 'px';
      checkHighlight.style.height = rect.height + 'px';
    });

    checkOverlay.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      // Find element underneath
      checkOverlay.style.pointerEvents = 'none';
      var target = document.elementFromPoint(e.clientX, e.clientY);
      checkOverlay.style.pointerEvents = '';

      if (!target || isToolbarElement(target)) return;

      var text = (target.textContent || '').trim().slice(0, 200);
      var tagName = target.tagName.toLowerCase();
      var selector = cssSelector(target);

      addStep({ type: 'check', text: text, elementTag: tagName, selector: selector });

      // Exit check mode
      checkMode = false;
      checkBtn.classList.remove('active');
      toolbar.classList.remove('check-mode');
      exitCheckMode();
    });
  }

  function exitCheckMode() {
    if (checkOverlay) {
      checkOverlay.remove();
      checkOverlay = null;
    }
    if (checkHighlight) {
      checkHighlight.remove();
      checkHighlight = null;
    }
  }

  /* ── Stop recording ────────────────────────────────────────── */
  function stopRecording() {
    if (stopped) return;
    // Commit any in-flight debounced fill before finalizing
    flushPendingFills();
    stopped = true;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    urlObserver.disconnect();
    window.removeEventListener('popstate', checkNavigation);
    // Detach interaction listeners so nothing records after Stop
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('input', onDocumentInput, true);
    document.removeEventListener('keydown', onDocumentKeydown, true);
    document.removeEventListener('blur', onDocumentBlur, true);
    document.removeEventListener('change', onSelectChange, true);
    document.removeEventListener('change', onFileChange, true);
    window.removeEventListener('beforeunload', onBeforeUnload);
    // Cancel any remaining debounce timers
    pendingFills.forEach(function (entry) { clearTimeout(entry.timer); });
    pendingFills.clear();
    bridge({ type: 'stop', steps: steps });
  }

  /* ── Helpers ───────────────────────────────────────────────── */
  function isToolbarElement(el) {
    return el.closest && el.closest('#sg-recorder');
  }

  function findLabel(el) {
    // aria-label
    var label = el.getAttribute('aria-label');
    if (label) return label;

    // Associated <label> element
    if (el.id) {
      var escapedId = CSS.escape(el.id);
      var labelEl = document.querySelector('label[for="' + escapedId + '"]');
      if (labelEl) return (labelEl.textContent || '').trim();
    }

    // placeholder
    if (el.placeholder) return el.placeholder;

    return null;
  }

  function cssSelector(el) {
    // Prefer id
    if (el.id) return '#' + el.id;

    // data-testid
    var testId = el.getAttribute('data-testid');
    if (testId) return '[data-testid="' + testId + '"]';

    // name attribute
    var name = el.getAttribute('name');
    if (name) return '[name="' + name + '"]';

    // Fallback: tagname, or tagname:nth-child if ambiguous
    var tag = el.tagName.toLowerCase();
    if (!el.parentElement) return tag;

    var siblings = Array.from(el.parentElement.children).filter(function (c) {
      return c.tagName === el.tagName;
    });

    if (siblings.length === 1) return tag;

    var idx = siblings.indexOf(el) + 1;
    return tag + ':nth-of-type(' + idx + ')';
  }

  /* ── Debounced fills (flushable) ───────────────────────────── */
  // Pending fills are kept in a Map so they can be flushed (committed
  // immediately) before a click, on blur, and before the page unloads —
  // otherwise a fill debounce timer would be lost on MPA form POSTs or
  // land AFTER the click that follows it.
  var pendingFills = new Map();

  function commitFill(el) {
    var entry = pendingFills.get(el);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingFills.delete(el);
    var label = findLabel(el) || '';
    var isPassword = (el.type === 'password');
    addStep({
      type: 'fill',
      text: label,
      selector: cssSelector(el),
      value: isPassword ? '{credentials.password}' : el.value,
      isPassword: isPassword
    });
  }

  function flushPendingFills() {
    Array.from(pendingFills.keys()).forEach(commitFill);
  }

  /* ── Event capture: click ──────────────────────────────────── */
  function onDocumentClick(e) {
    if (stopped) return;
    // Make sure a pending fill lands before the click that follows it
    flushPendingFills();
    if (paused || checkMode) return;
    if (isToolbarElement(e.target)) return;

    // Find nearest interactive element
    var el = e.target.closest('a, button, [role=button], input[type=submit], [onclick]') || e.target;

    // Skip input/textarea/select — fill/change handlers cover those
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    var text = (el.textContent || '').trim().slice(0, 80);

    addStep({
      type: 'click',
      text: text,
      selector: cssSelector(el),
      tagName: el.tagName.toLowerCase()
    });
  }
  document.addEventListener('click', onDocumentClick, true);

  /* ── Event capture: input (debounced per element) ──────────── */
  function onDocumentInput(e) {
    if (paused || checkMode || stopped) return;
    if (isToolbarElement(e.target)) return;

    var el = e.target;
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return;

    // Reset the debounce for this element
    var prev = pendingFills.get(el);
    if (prev) clearTimeout(prev.timer);

    pendingFills.set(el, {
      timer: setTimeout(function () { commitFill(el); }, 800)
    });
  }
  document.addEventListener('input', onDocumentInput, true);

  /* ── Event capture: Enter key in form fields ───────────────── */
  function onDocumentKeydown(e) {
    if (paused || checkMode || stopped) return;
    if (e.key !== 'Enter') return;
    if (!e.target || isToolbarElement(e.target)) return;
    var tag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
    // Enter in a textarea inserts a newline — only record single-line fields
    if (tag !== 'input' && tag !== 'select') return;
    // Commit this field's pending fill BEFORE the key press
    commitFill(e.target);
    addStep({ type: 'press', key: 'Enter' });
  }
  document.addEventListener('keydown', onDocumentKeydown, true);

  /* ── Event capture: blur (commit pending fill) ─────────────── */
  function onDocumentBlur(e) {
    if (stopped) return;
    if (e.target) commitFill(e.target);
  }
  document.addEventListener('blur', onDocumentBlur, true);

  /* ── Flush pending fills before the page unloads (MPA POST) ── */
  function onBeforeUnload() {
    flushPendingFills();
  }
  window.addEventListener('beforeunload', onBeforeUnload);

  /* ── Event capture: change (select elements) ───────────────── */
  function onSelectChange(e) {
    if (paused || checkMode || stopped) return;
    if (isToolbarElement(e.target)) return;

    var el = e.target;
    var tag = el.tagName.toLowerCase();

    if (tag === 'select') {
      var label = findLabel(el) || '';
      var selectedOption = el.options[el.selectedIndex];
      var optionText = selectedOption ? selectedOption.textContent.trim() : el.value;

      addStep({
        type: 'select',
        text: label,
        selector: cssSelector(el),
        value: optionText
      });
    }
  }
  document.addEventListener('change', onSelectChange, true);

  /* ── Event capture: change (file inputs) ───────────────────── */
  function onFileChange(e) {
    if (paused || checkMode || stopped) return;
    if (isToolbarElement(e.target)) return;

    var el = e.target;
    if (el.tagName.toLowerCase() !== 'input' || el.type !== 'file') return;

    addStep({
      type: 'upload',
      selector: cssSelector(el),
      files: Array.from(el.files).map(function (f) { return f.name; })
    });
  }
  document.addEventListener('change', onFileChange, true);

  /* ── Navigation detection ──────────────────────────────────── */
  function checkNavigation() {
    if (location.href !== lastUrl) {
      var newUrl = location.href;
      lastUrl = newUrl;
      addStep({ type: 'open', url: newUrl });
    }
  }

  // MutationObserver on body for SPA route changes
  var urlObserver = new MutationObserver(checkNavigation);
  urlObserver.observe(document.body, { childList: true, subtree: true });

  // popstate for history navigation
  window.addEventListener('popstate', checkNavigation);

  /* ── Initial render ────────────────────────────────────────── */
  renderSteps();
})();
