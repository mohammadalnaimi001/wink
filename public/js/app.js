/* ==========================================================
   Wink Cafe — front-end application
   ========================================================== */
(function () {
  'use strict';

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const ICONS = { sofa: '#i-sofa', leaf: '#i-leaf', tv: '#i-tv', star: '#i-spark' };

  const state = {
    cfg: null, menu: null,
    date: '', area: '', time: '', guests: 2,
    occasion: 'casual', shisha: false, shishaCount: 1, notes: '',
    step: 1, availability: null, lastBooking: null
  };

  /* ---------------- cookies (language memory) ---------------- */
  function setCookie(n, v, days) {
    const d = new Date(Date.now() + days * 864e5);
    document.cookie = `${n}=${encodeURIComponent(v)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  }
  function getCookie(n) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const isAr = () => window.LANG === 'ar';
  const money = (n) => Number(n).toFixed(2);
  const cur = () => (state.cfg ? (isAr() ? state.cfg.cafe.currencyAr : state.cfg.cafe.currencyEn) : 'JOD');

  function pad(n) { return String(n).padStart(2, '0'); }

  function localDateStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function prettyDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    try {
      return new Intl.DateTimeFormat(isAr() ? 'ar-JO' : 'en-GB',
        { weekday: 'long', day: 'numeric', month: 'long' }).format(dt);
    } catch (e) { return dateStr; }
  }

  function prettyTime(t) {
    const [h, m] = t.split(':').map(Number);
    const suffix = h < 12 ? (isAr() ? 'ص' : 'AM') : (isAr() ? 'م' : 'PM');
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${pad(m)} ${suffix}`;
  }

  function areaObj(id) { return state.cfg ? state.cfg.areas.find((a) => a.id === id) : null; }
  function areaName(id) { const a = areaObj(id); return a ? (isAr() ? a.nameAr : a.nameEn) : id; }
  function occName(id) {
    const o = state.cfg && state.cfg.occasions.find((x) => x.id === id);
    return o ? (isAr() ? o.nameAr : o.nameEn) : id;
  }

  function alertBox(target, kind, msg) {
    const icon = kind === 'ok' ? '#i-check' : kind === 'err' ? '#i-alert' : '#i-info';
    target.innerHTML = msg
      ? `<div class="alert ${kind}"><svg><use href="${icon}"/></svg><span>${esc(msg)}</span></div>` : '';
    if (msg) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function api(url, opts) {
    const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  }

  /* ---------------- language ---------------- */
  function applyLang(lang) {
    window.LANG = lang;
    setCookie('wink_lang', lang, 365);
    const rtl = lang === 'ar';
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.body.dir = rtl ? 'rtl' : 'ltr';
    document.title = window.t('html.title');
    $('#langLabel').textContent = rtl ? 'English' : 'العربية';

    $$('[data-i18n]').forEach((el) => { el.textContent = window.t(el.dataset.i18n); });
    $$('[data-i18n-html]').forEach((el) => { el.innerHTML = window.t(el.dataset.i18nHtml); });
    $$('[data-i18n-ph]').forEach((el) => { el.placeholder = window.t(el.dataset.i18nPh); });

    if (state.menu) { renderMenu(); renderFlavors(); }
    if (state.cfg) { renderAreas(); renderOccasions(); renderSummary(); }
    renderMatches(state.matches || []);
    renderSlots();
    refreshStatus();
  }

  /* ---------------- open / closed status ----------------
     Uses the café's own clock (sent by the server) rather than the
     visitor's, so it reads correctly from anywhere in the world. */
  function refreshStatus() {
    if (!state.cfg) return;
    const { openHour, closeHour } = state.cfg.cafe;
    const elapsed = Math.floor((Date.now() - state.cfgFetchedAt) / 60000);
    const nowMin = ((state.cfg.nowMinutes + elapsed) % 1440 + 1440) % 1440;

    const openMin = openHour * 60;
    const closeMin = (closeHour <= openHour ? closeHour + 24 : closeHour) * 60;
    const m = nowMin < openMin ? nowMin + 1440 : nowMin;
    const isOpen = m >= openMin && m < closeMin;

    $('#statusDot').classList.toggle('closed', !isOpen);
    $('#statusText').textContent = window.t(isOpen ? 'status.open' : 'status.closed');
  }

  /* ---------------- menu ---------------- */
  function renderMenu(activeId) {
    const cats = state.menu.categories;
    const active = activeId || (state.activeCat && cats.some((c) => c.id === state.activeCat) ? state.activeCat : cats[0].id);
    state.activeCat = active;

    $('#menuTabs').innerHTML = cats.map((c) =>
      `<button type="button" data-cat="${c.id}" class="${c.id === active ? 'active' : ''}">${esc(isAr() ? c.nameAr : c.nameEn)}</button>`
    ).join('');

    const cat = cats.find((c) => c.id === active);
    $('#menuGrid').innerHTML = cat.items.map((it) => {
      const name = esc(isAr() ? it.ar : it.en);
      const alt = esc(isAr() ? it.en : it.ar);
      const desc = isAr() ? it.descAr : it.descEn;
      const pill = it.tag ? `<span class="pill ${it.tag}">${esc(window.t('pill.' + it.tag))}</span>` : '';
      return `<div class="mi">
        <div class="mi-body">
          <div class="mi-name">${name} ${pill}</div>
          <div class="mi-desc">${desc ? esc(desc) : alt}</div>
        </div>
        <div class="mi-price">${money(it.price)}<small>${esc(cur())}</small></div>
      </div>`;
    }).join('');

    $$('#menuTabs button').forEach((b) =>
      b.addEventListener('click', () => renderMenu(b.dataset.cat)));
  }

  function renderFlavors() {
    const cat = state.menu.categories.find((c) => c.id === 'shisha');
    if (!cat) return;
    const items = cat.items.filter((i) => i.price >= 4);
    $('#flavors').innerHTML = items.map((i) =>
      `<span class="flavor">${esc(isAr() ? i.ar : i.en)} <b>${money(i.price)} ${esc(cur())}</b></span>`
    ).join('');
  }

  /* ---------------- matches ---------------- */
  function renderMatches(list) {
    state.matches = list;
    const box = $('#matchList');
    if (!list || !list.length) {
      box.innerHTML = `<div class="empty">${esc(window.t('match.empty'))}</div>`;
      return;
    }
    const today = localDateStr(new Date());
    const tomorrow = localDateStr(new Date(Date.now() + 864e5));
    box.innerHTML = list.map((m) => {
      const [d, tm] = m.kickoff.split(' ');
      let when;
      if (d === today) when = window.t('match.today');
      else if (d === tomorrow) when = window.t('match.tomorrow');
      else when = prettyDate(d).split(' ').slice(0, 2).join(' ');
      return `<div class="match">
        <div class="match-when"><b>${esc(tm)}</b><span>${esc(when)}</span></div>
        <div class="match-teams">
          <b>${esc(m.team_a)} <span style="color:var(--muted-2)">vs</span> ${esc(m.team_b)}</b>
          <span>${esc(m.competition)}${m.note ? ' · ' + esc(m.note) : ''}</span>
        </div>
      </div>`;
    }).join('');
  }

  /* ---------------- booking: areas & occasions ---------------- */
  function renderAreas() {
    $('#areaList').innerHTML = state.cfg.areas.map((a) => `
      <div class="area ${state.area === a.id ? 'sel' : ''}" data-area="${a.id}" role="button" tabindex="0">
        <span class="ic"><svg><use href="${ICONS[a.icon] || '#i-sofa'}"/></svg></span>
        <div>
          <b>${esc(isAr() ? a.nameAr : a.nameEn)}</b>
          <p>${esc(isAr() ? a.descAr : a.descEn)}</p>
          <span class="cap">${a.shisha ? (isAr() ? 'أرجيلة متوفرة' : 'Shisha available') : (isAr() ? 'بدون أرجيلة' : 'No shisha')} · ${a.capacity} ${isAr() ? 'مقعد' : 'seats'}</span>
        </div>
      </div>`).join('');

    $$('#areaList .area').forEach((el) => {
      const pick = () => {
        state.area = el.dataset.area;
        renderAreas();
        const a = areaObj(state.area);
        if (a && !a.shisha) { state.shisha = false; $('#bkShisha').checked = false; syncShisha(); }
        loadAvailability();
      };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }

  function renderOccasions() {
    $('#occList').innerHTML = state.cfg.occasions.map((o) =>
      `<button type="button" class="chip ${state.occasion === o.id ? 'sel' : ''}" data-occ="${o.id}">${esc(isAr() ? o.nameAr : o.nameEn)}</button>`
    ).join('');
    $$('#occList .chip').forEach((b) => b.addEventListener('click', () => {
      state.occasion = b.dataset.occ;
      renderOccasions();
      if (state.occasion === 'match' && state.area !== 'match') {
        const el = $('#areaList .area[data-area="match"]');
        if (el) el.click();
      }
    }));
  }

  /* ---------------- booking: availability & slots ---------------- */
  let availTimer = null;
  function loadAvailability() {
    clearTimeout(availTimer);
    availTimer = setTimeout(doLoadAvailability, 140);
  }

  async function doLoadAvailability() {
    if (!state.date) return;
    $('#slotList').innerHTML = `<div class="empty">${esc(window.t('bk.loading'))}</div>`;
    const r = await api(`/api/availability?date=${encodeURIComponent(state.date)}`);
    if (!r.ok || !r.data || !r.data.ok) {
      state.availability = null;
      $('#slotList').innerHTML = `<div class="empty">${esc(window.t('err.network'))}</div>`;
      return;
    }
    state.availability = r.data;
    renderSlots();
  }

  function renderSlots() {
    const box = $('#slotList');
    if (!box) return;
    if (!state.availability) {
      box.innerHTML = `<div class="empty">${esc(window.t('bk.pickDate'))}</div>`;
      return;
    }
    if (state.availability.closed) {
      box.innerHTML = `<div class="empty">${esc(window.t('bk.closedDay'))}</div>`;
      return;
    }
    if (!state.availability.slots.length) {
      box.innerHTML = `<div class="empty">${esc(window.t('bk.noSlots'))}</div>`;
      return;
    }
    if (!state.area) {
      box.innerHTML = `<div class="empty">${esc(window.t('err.pickArea'))}</div>`;
      return;
    }

    box.innerHTML = state.availability.slots.map((s) => {
      const free = s.free[state.area];
      const full = free === undefined || free < state.guests;
      const label = full ? window.t('slot.full') : `${free} ${window.t('slot.left')}`;
      return `<button type="button" class="slot ${state.time === s.time ? 'sel' : ''}" data-time="${s.time}" ${full ? 'disabled' : ''}>
        ${esc(s.time)}<small>${esc(label)}</small>
      </button>`;
    }).join('');

    $$('#slotList .slot').forEach((b) => b.addEventListener('click', () => {
      state.time = b.dataset.time;
      renderSlots();
      alertBox($('#bkAlert'), '', '');
    }));
  }

  function syncShisha() {
    const a = areaObj(state.area);
    const allowed = !a || a.shisha;
    const field = $('#shishaField');
    field.style.opacity = allowed ? '1' : '.45';
    $('#bkShisha').disabled = !allowed;
    $('#shishaCountBox').style.display = (state.shisha && allowed) ? 'block' : 'none';
    const sub = field.querySelector('.toggle b span:last-child');
    if (sub) sub.textContent = window.t(allowed ? 'bk.shishaSub' : 'bk.shishaNo');
  }

  /* ---------------- steps ---------------- */
  function goStep(n) {
    state.step = n;
    $$('.pane').forEach((p) => p.classList.toggle('on', Number(p.dataset.pane) === n));
    $$('.step').forEach((s) => {
      const i = Number(s.dataset.step);
      s.classList.toggle('active', i === n);
      s.classList.toggle('done', i < n);
    });
    alertBox($('#bkAlert'), '', '');
    if (n === 3) renderSummary();
    const bk = $('.bk');
    if (bk) {
      const y = bk.getBoundingClientRect().top + window.scrollY - 90;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }

  function renderSummary() {
    const box = $('#bkSummary');
    if (!box) return;
    const g = state.guests;
    box.innerHTML = `<h4>${esc(window.t('bk.summary'))}</h4>
      <dl>
        <dt>${esc(window.t('sum.date'))}</dt><dd>${esc(state.date ? prettyDate(state.date) : window.t('sum.none'))}</dd>
        <dt>${esc(window.t('sum.time'))}</dt><dd>${esc(state.time ? prettyTime(state.time) : window.t('sum.none'))}</dd>
        <dt>${esc(window.t('sum.guests'))}</dt><dd>${g} ${esc(window.t(g === 1 ? 'sum.person' : 'sum.persons'))}</dd>
        <dt>${esc(window.t('sum.area'))}</dt><dd>${esc(state.area ? areaName(state.area) : window.t('sum.none'))}</dd>
        <dt>${esc(window.t('sum.occasion'))}</dt><dd>${esc(occName(state.occasion))}</dd>
        <dt>${esc(window.t('sum.shisha'))}</dt><dd>${state.shisha ? state.shishaCount : esc(window.t('sum.none'))}</dd>
      </dl>`;
  }

  function validPhone(v) {
    const d = String(v).replace(/[^\d+]/g, '');
    return /^(\+?962)?7\d{8}$/.test(d.replace(/^0/, '')) || /^07\d{8}$/.test(d) || /^\+?\d{9,15}$/.test(d);
  }

  /* ---------------- submit ---------------- */
  async function submitBooking() {
    const name = $('#bkName').value.trim();
    const phone = $('#bkPhone').value.trim();
    const email = $('#bkEmail').value.trim();
    const box = $('#bkAlert');

    if (name.length < 2) return alertBox(box, 'err', window.t('err.name'));
    if (!validPhone(phone)) return alertBox(box, 'err', window.t('err.phone'));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alertBox(box, 'err', window.t('err.email'));

    const btn = $('#submitBk');
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = `<span>${esc(window.t('bk.sending'))}</span>`;

    let r;
    try {
      r = await api('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          name, phone, email,
          date: state.date, time: state.time, guests: state.guests,
          area: state.area, occasion: state.occasion,
          shisha: state.shisha, shishaCount: state.shishaCount,
          notes: $('#bkNotes').value.trim(), lang: window.LANG
        })
      });
    } catch (e) {
      btn.disabled = false; btn.innerHTML = original;
      return alertBox(box, 'err', window.t('err.network'));
    }

    btn.disabled = false;
    btn.innerHTML = original;

    if (!r.ok || !r.data || !r.data.ok) {
      const code = r.data && r.data.error ? r.data.error : 'generic';
      const msg = window.t('err.' + code);
      alertBox(box, 'err', msg === 'err.' + code ? window.t('err.generic') : msg);
      if (code === 'no_capacity' || code === 'too_soon') { goStep(1); doLoadAvailability(); }
      return;
    }

    state.lastBooking = r.data.booking;
    $('#okCode').textContent = r.data.booking.code;
    $('#okWa').href = r.data.whatsapp;
    $('#okDetails').innerHTML =
      `${esc(prettyDate(state.date))} · ${esc(prettyTime(state.time))} · ${state.guests} ${esc(window.t(state.guests === 1 ? 'sum.person' : 'sum.persons'))} · ${esc(areaName(state.area))}`;
    goStep(4);
    $$('.step').forEach((s) => { s.classList.remove('active'); s.classList.add('done'); });
  }

  /* ---------------- .ics calendar file ---------------- */
  function downloadIcs() {
    if (!state.lastBooking) return;
    const b = state.lastBooking;
    const [y, m, d] = b.date.split('-').map(Number);
    const [hh, mm] = b.time.split(':').map(Number);
    const start = new Date(y, m - 1, d, hh, mm);
    if (hh < 10) start.setDate(start.getDate() + 1);
    const end = new Date(start.getTime() + 2 * 3600e3);
    const z = (dt) => dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const c = state.cfg.cafe;
    const phone = `+${c.phoneIntl}`;
    const title = isAr() ? `حجز في ${c.nameAr} (${b.code})` : `${c.nameEn} reservation (${b.code})`;
    const desc = isAr()
      ? `عدد الأشخاص: ${b.guests}\\nالقسم: ${areaName(b.area)}\\nرقم الحجز: ${b.code}\\nهاتف الكافيه: ${phone}`
      : `Guests: ${b.guests}\\nArea: ${areaName(b.area)}\\nCode: ${b.code}\\nCafé phone: ${phone}`;
    const place = [c.nameEn, c.streetEn, c.cityEn].filter(Boolean).join(', ');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${c.nameEn}//Booking//EN`, 'BEGIN:VEVENT',
      `UID:${b.code}@${c.nameEn.toLowerCase().replace(/[^a-z0-9]/g, '')}.jo`,
      `DTSTAMP:${z(new Date())}`, `DTSTART:${z(start)}`, `DTEND:${z(end)}`,
      `SUMMARY:${title}`, `DESCRIPTION:${desc}`, `LOCATION:${place}`,
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${c.nameEn.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${b.code}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /* ---------------- manage booking ---------------- */
  async function findBooking() {
    const code = $('#mgCode').value.trim().toUpperCase();
    const last4 = $('#mgPhone').value.trim();
    const box = $('#mgResult');
    if (!code || last4.length < 4) return alertBox(box, 'err', window.t('mg.notFound'));

    const r = await api(`/api/bookings/${encodeURIComponent(code)}?phone=${encodeURIComponent(last4)}`);
    if (!r.ok || !r.data || !r.data.ok) return alertBox(box, 'err', window.t('mg.notFound'));

    const b = r.data.booking;
    const cancellable = b.status !== 'cancelled';
    box.innerHTML = `
      <div class="summary" style="margin-bottom:14px">
        <h4>${esc(b.code)} — ${esc(window.t('st.' + b.status))}</h4>
        <dl>
          <dt>${esc(window.t('bk.name'))}</dt><dd>${esc(b.name)}</dd>
          <dt>${esc(window.t('sum.date'))}</dt><dd>${esc(prettyDate(b.date))}</dd>
          <dt>${esc(window.t('sum.time'))}</dt><dd>${esc(prettyTime(b.time))}</dd>
          <dt>${esc(window.t('sum.guests'))}</dt><dd>${b.guests}</dd>
          <dt>${esc(window.t('sum.area'))}</dt><dd>${esc(areaName(b.area))}</dd>
          <dt>${esc(window.t('sum.shisha'))}</dt><dd>${b.shisha ? b.shishaCount : esc(window.t('sum.none'))}</dd>
        </dl>
      </div>
      ${cancellable ? `<button class="btn btn-ghost btn-sm" id="mgCancel" type="button">${esc(window.t('mg.cancel'))}</button>` : ''}`;

    const cancelBtn = $('#mgCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', async () => {
      if (!window.confirm(window.t('mg.confirmCancel'))) return;
      const rr = await api(`/api/bookings/${encodeURIComponent(code)}/cancel`,
        { method: 'POST', body: JSON.stringify({ phone: last4 }) });
      if (rr.ok && rr.data && rr.data.ok) alertBox(box, 'ok', window.t('mg.cancelled'));
      else alertBox(box, 'err', window.t('err.generic'));
    });
  }

  /* ---------------- contact ---------------- */
  async function sendContact() {
    const name = $('#ctName').value.trim();
    const contact = $('#ctContact').value.trim();
    const message = $('#ctMsg').value.trim();
    const box = $('#ctAlert');
    if (name.length < 2 || contact.length < 5 || message.length < 5) {
      return alertBox(box, 'err', window.t('ct.err'));
    }
    const r = await api('/api/contact', { method: 'POST', body: JSON.stringify({ name, contact, message }) });
    if (r.ok && r.data && r.data.ok) {
      alertBox(box, 'ok', window.t('ct.ok'));
      $('#ctName').value = ''; $('#ctContact').value = ''; $('#ctMsg').value = '';
    } else alertBox(box, 'err', window.t('err.generic'));
  }

  /* ---------------- misc UI ---------------- */
  function initReveal() {
    if (!('IntersectionObserver' in window)) {
      $$('.reveal').forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach((el) => io.observe(el));
  }

  function initNav() {
    const links = $('#navLinks');
    let dim = null;

    function closeDrawer() {
      links.classList.remove('open');
      if (dim) { dim.remove(); dim = null; }
      document.body.style.overflow = '';
    }
    function openDrawer() {
      links.classList.add('open');
      dim = document.createElement('div');
      dim.className = 'navdim';
      dim.addEventListener('click', closeDrawer);
      document.body.appendChild(dim);
      document.body.style.overflow = 'hidden';
    }

    $('#burger').addEventListener('click', () =>
      (links.classList.contains('open') ? closeDrawer() : openDrawer()));
    $$('#navLinks a').forEach((a) => a.addEventListener('click', closeDrawer));
    $('#navClose').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 980) closeDrawer(); });

    const sections = ['about', 'menu', 'shisha', 'gallery', 'reviews', 'location'];
    window.addEventListener('scroll', () => {
      let current = '';
      sections.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 140) current = id;
      });
      $$('#navLinks a').forEach((a) =>
        a.classList.toggle('active', a.getAttribute('href') === '#' + current));
    }, { passive: true });
  }

  function initCounters() {
    const bind = (minus, plus, input, key, min, max, after) => {
      const set = (v) => {
        const n = Math.min(max, Math.max(min, Number(v) || min));
        state[key] = n; input.value = n;
        if (after) after();
      };
      $(minus).addEventListener('click', () => set(state[key] - 1));
      $(plus).addEventListener('click', () => set(state[key] + 1));
      input.addEventListener('change', () => set(input.value));
      set(state[key]);
    };
    bind('#gMinus', '#gPlus', $('#bkGuests'), 'guests', 1, 20, () => { renderSlots(); renderSummary(); });
    bind('#sMinus', '#sPlus', $('#bkShishaCount'), 'shishaCount', 1, 10, renderSummary);
  }

  function initLinks() {
    const c = state.cfg.cafe;
    const wa = `https://wa.me/${c.phoneIntl}`;
    ['#fabWa', '#waInfo', '#footWa'].forEach((s) => { const el = $(s); if (el) el.href = wa; });
    ['#dirLink', '#footMaps', '#mapOpen'].forEach((s) => { const el = $(s); if (el) el.href = c.mapsUrl; });
    // إذا خلّيت talabatUrl فاضي في server/config.js، أزرار الطلب بتختفي من الموقع
    ['#talabatBtn', '#talabatInfo', '#footTalabat'].forEach((s) => {
      const el = $(s);
      if (!el) return;
      if (c.talabatUrl) el.href = c.talabatUrl;
      else el.style.display = 'none';
    });
    const map = $('#mapFrame'); if (map) map.src = c.mapsEmbed;
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    const [cfgRes, menuRes, matchRes] = await Promise.all([
      api('/api/config'), api('/api/menu'), api('/api/matches')
    ]);
    if (!cfgRes.ok || !cfgRes.data) {
      document.body.insertAdjacentHTML('afterbegin',
        '<div class="alert err" style="margin:20px">Server unreachable — start it with <code>npm start</code>.</div>');
      return;
    }
    state.cfg = cfgRes.data;
    state.cfgFetchedAt = Date.now();
    state.menu = menuRes.data.menu;

    // date bounds
    const today = state.cfg.today;
    const max = localDateStr(new Date(Date.now() + state.cfg.maxDaysAhead * 864e5));
    const dateEl = $('#bkDate');
    dateEl.min = today; dateEl.max = max; dateEl.value = today;
    state.date = today;
    state.area = 'terrace';

    const saved = getCookie('wink_lang');
    const browser = (navigator.language || 'ar').toLowerCase().startsWith('ar') ? 'ar' : 'en';
    applyLang(saved || browser);

    initLinks();
    initCounters();
    renderMatches(matchRes.data && matchRes.data.matches ? matchRes.data.matches : []);
    syncShisha();
    loadAvailability();
    initReveal();
    initNav();
    setInterval(refreshStatus, 60000);

    // events
    $('#langBtn').addEventListener('click', () => applyLang(isAr() ? 'en' : 'ar'));
    dateEl.addEventListener('change', () => {
      state.date = dateEl.value; state.time = '';
      loadAvailability(); renderSummary();
    });
    $('#bkShisha').addEventListener('change', (e) => {
      state.shisha = e.target.checked; syncShisha(); renderSummary();
    });
    $('#bkNotes').addEventListener('input', (e) => { state.notes = e.target.value; });

    $('#to2').addEventListener('click', () => {
      if (!state.area) return alertBox($('#bkAlert'), 'err', window.t('err.pickArea'));
      if (!state.time) return alertBox($('#bkAlert'), 'err', window.t('err.pickTime'));
      goStep(2);
    });
    $('#to3').addEventListener('click', () => goStep(3));
    $('#back1').addEventListener('click', () => goStep(1));
    $('#back2').addEventListener('click', () => goStep(2));
    $('#submitBk').addEventListener('click', submitBooking);
    $('#okIcs').addEventListener('click', downloadIcs);
    $('#okNew').addEventListener('click', () => {
      state.time = ''; $('#bkName').value = ''; $('#bkPhone').value = '';
      $('#bkEmail').value = ''; $('#bkNotes').value = '';
      goStep(1); doLoadAvailability();
    });
    $('#mgBtn').addEventListener('click', findBooking);
    $('#ctBtn').addEventListener('click', sendContact);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
