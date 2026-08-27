'use strict';

process.env.TZ = process.env.TZ || 'Asia/Amman';
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const { cafe, areas, occasions, SLOT_HOLD_MINUTES, MAX_DAYS_AHEAD, MIN_LEAD_MINUTES } = require('./config');
const T = require('./timeutil');
const { sendBookingMails, mailEnabled } = require('./mailer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'wink2026';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex');

app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

const menu = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'menu.json'), 'utf8'));

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

const nowIso = () => new Date().toISOString();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return `${cafe.bookingPrefix || 'BK'}-${s}`;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (/^\+?962\d{9}$/.test(digits)) return digits.startsWith('+') ? digits : `+${digits}`;
  if (/^07\d{8}$/.test(digits)) return `+962${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) return `+962${digits}`;
  return digits;
}

function validPhone(raw) {
  const p = normalizePhone(raw);
  return /^\+9627\d{8}$/.test(p) || /^\+?\d{8,15}$/.test(p);
}

function clean(str, max = 500) {
  return String(str == null ? '' : str).trim().slice(0, max);
}

function areaById(id) {
  return areas.find((a) => a.id === id) || null;
}

/** Seats already committed in `area` for windows overlapping [start,end). */
function seatsTaken(area, startStr, endStr, excludeId) {
  const sql = `SELECT COALESCE(SUM(guests),0) AS s FROM bookings
               WHERE area = ? AND status IN ('pending','confirmed','seated')
                 AND start_at < ? AND end_at > ? ${excludeId ? 'AND id <> ?' : ''}`;
  const args = excludeId ? [area, endStr, startStr, excludeId] : [area, endStr, startStr];
  return db.prepare(sql).get(...args).s;
}

function isBlackout(date) {
  return !!db.prepare('SELECT 1 FROM blackouts WHERE date = ?').get(date);
}

function whatsappLink(b) {
  const a = areaById(b.area);
  const lines = [
    `*حجز جديد — ${cafe.nameAr}*`,
    `رقم الحجز: ${b.code}`,
    `الاسم: ${b.name}`,
    `الهاتف: ${b.phone}`,
    `التاريخ: ${b.date}`,
    `الوقت: ${b.time}`,
    `عدد الأشخاص: ${b.guests}`,
    `القسم: ${a ? a.nameAr : b.area}`,
    b.shisha ? `أرجيلة: ${b.shisha_count}` : null,
    b.notes ? `ملاحظات: ${b.notes}` : null
  ].filter(Boolean);
  return `https://wa.me/${cafe.phoneIntl}?text=${encodeURIComponent(lines.join('\n'))}`;
}

/* ------------------------------------------------------------------ *
 *  Admin auth (HMAC cookie — no external session store needed)
 * ------------------------------------------------------------------ */

function signToken(ttlMs = 1000 * 60 * 60 * 12) {
  const exp = Date.now() + ttlMs;
  const payload = `admin.${exp}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [who, exp, sig] = parts;
  if (who !== 'admin' || Number(exp) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${who}.${exp}`).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (verifyToken(req.cookies.wink_admin)) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false });
const bookingLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 25, standardHeaders: true, legacyHeaders: false });

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    cafe,
    areas,
    occasions,
    slotHoldMinutes: SLOT_HOLD_MINUTES,
    maxDaysAhead: MAX_DAYS_AHEAD,
    minLeadMinutes: MIN_LEAD_MINUTES,
    today: T.fmtDate(new Date()),
    // café-local clock, so "open now" is right for visitors in any timezone
    nowMinutes: (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })(),
    mailEnabled: mailEnabled()
  });
});

app.get('/api/menu', (req, res) => res.json({ ok: true, menu }));

app.get('/api/matches', (req, res) => {
  const cutoff = T.fmt(T.addMinutes(new Date(), -120));
  const rows = db.prepare(
    'SELECT * FROM matches WHERE active = 1 AND kickoff >= ? ORDER BY kickoff ASC LIMIT 8'
  ).all(cutoff);
  res.json({ ok: true, matches: rows });
});

/** Per-slot availability for one date, for every area (or one). */
app.get('/api/availability', (req, res) => {
  const date = clean(req.query.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'bad_date' });

  const maxDate = T.fmtDate(new Date(Date.now() + MAX_DAYS_AHEAD * 864e5));
  if (date > maxDate) return res.status(400).json({ ok: false, error: 'too_far_ahead' });
  if (isBlackout(date)) return res.json({ ok: true, date, closed: true, slots: [] });

  const wanted = req.query.area ? [req.query.area] : areas.map((a) => a.id);
  const labels = T.availableSlotLabels(date, MIN_LEAD_MINUTES);

  const slots = labels.map((label) => {
    const w = T.bookingWindow(date, label);
    const perArea = {};
    for (const id of wanted) {
      const a = areaById(id);
      if (!a) continue;
      const taken = seatsTaken(id, w.startStr, w.endStr);
      perArea[id] = Math.max(0, a.capacity - taken);
    }
    return { time: label, free: perArea };
  });

  res.json({ ok: true, date, closed: false, slots });
});

app.post('/api/bookings', bookingLimiter, async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 80);
  const phoneRaw = clean(b.phone, 25);
  const email = clean(b.email, 120);
  const date = clean(b.date, 10);
  const time = clean(b.time, 5);
  const guests = Number(b.guests);
  const area = clean(b.area, 20);
  const occasion = clean(b.occasion, 20) || 'casual';
  const shisha = b.shisha ? 1 : 0;
  const shishaCount = shisha ? Math.min(10, Math.max(1, Number(b.shishaCount) || 1)) : 0;
  const notes = clean(b.notes, 400);
  const lang = b.lang === 'en' ? 'en' : 'ar';

  const errors = [];
  if (name.length < 2) errors.push('name');
  if (!validPhone(phoneRaw)) errors.push('phone');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('date');
  if (!T.allSlots().includes(time)) errors.push('time');
  if (!Number.isInteger(guests) || guests < 1 || guests > 20) errors.push('guests');
  const areaObj = areaById(area);
  if (!areaObj) errors.push('area');
  if (!occasions.some((o) => o.id === occasion)) errors.push('occasion');
  if (errors.length) return res.status(400).json({ ok: false, error: 'validation', fields: errors });

  if (isBlackout(date)) return res.status(409).json({ ok: false, error: 'closed_that_day' });

  const w = T.bookingWindow(date, time);
  if (w.start.getTime() < Date.now() + MIN_LEAD_MINUTES * 60000) {
    return res.status(409).json({ ok: false, error: 'too_soon' });
  }
  if (w.start.getTime() > Date.now() + MAX_DAYS_AHEAD * 864e5) {
    return res.status(409).json({ ok: false, error: 'too_far_ahead' });
  }
  if (shisha && !areaObj.shisha) {
    return res.status(409).json({ ok: false, error: 'no_shisha_in_area' });
  }

  const taken = seatsTaken(area, w.startStr, w.endStr);
  const free = areaObj.capacity - taken;
  if (guests > free) {
    return res.status(409).json({ ok: false, error: 'no_capacity', free: Math.max(0, free) });
  }

  const phone = normalizePhone(phoneRaw);
  let code = makeCode();
  for (let i = 0; i < 5 && db.prepare('SELECT 1 FROM bookings WHERE code = ?').get(code); i++) code = makeCode();

  const ts = nowIso();
  const info = db.prepare(`
    INSERT INTO bookings (code,name,phone,email,date,time,start_at,end_at,guests,area,occasion,shisha,shisha_count,notes,lang,status,created_at,updated_at,ip)
    VALUES (@code,@name,@phone,@email,@date,@time,@start_at,@end_at,@guests,@area,@occasion,@shisha,@shisha_count,@notes,@lang,'pending',@created_at,@updated_at,@ip)
  `).run({
    code, name, phone, email: email || null, date, time,
    start_at: w.startStr, end_at: w.endStr,
    guests, area, occasion, shisha, shisha_count: shishaCount,
    notes: notes || null, lang, created_at: ts, updated_at: ts,
    ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim()
  });

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);
  const mail = await sendBookingMails(booking);

  res.status(201).json({
    ok: true,
    booking: {
      code: booking.code, name: booking.name, phone: booking.phone, date: booking.date,
      time: booking.time, guests: booking.guests, area: booking.area,
      shisha: !!booking.shisha, shishaCount: booking.shisha_count, status: booking.status
    },
    whatsapp: whatsappLink(booking),
    emailSent: mail.sent
  });
});

/** Guest self-service lookup: code + last 4 phone digits. */
app.get('/api/bookings/:code', (req, res) => {
  const code = clean(req.params.code, 12).toUpperCase();
  const last4 = clean(req.query.phone, 6);
  const row = db.prepare('SELECT * FROM bookings WHERE code = ?').get(code);
  if (!row || !row.phone.endsWith(last4) || last4.length < 4) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  res.json({
    ok: true,
    booking: {
      code: row.code, name: row.name, date: row.date, time: row.time, guests: row.guests,
      area: row.area, shisha: !!row.shisha, shishaCount: row.shisha_count,
      occasion: row.occasion, notes: row.notes, status: row.status
    }
  });
});

app.post('/api/bookings/:code/cancel', (req, res) => {
  const code = clean(req.params.code, 12).toUpperCase();
  const last4 = clean((req.body || {}).phone, 6);
  const row = db.prepare('SELECT * FROM bookings WHERE code = ?').get(code);
  if (!row || last4.length < 4 || !row.phone.endsWith(last4)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  if (row.status === 'cancelled') return res.json({ ok: true, alreadyCancelled: true });
  db.prepare("UPDATE bookings SET status='cancelled', updated_at=? WHERE id=?").run(nowIso(), row.id);
  res.json({ ok: true });
});

app.post('/api/contact', bookingLimiter, (req, res) => {
  const name = clean((req.body || {}).name, 80);
  const contact = clean((req.body || {}).contact, 120);
  const message = clean((req.body || {}).message, 1200);
  if (name.length < 2 || contact.length < 5 || message.length < 5) {
    return res.status(400).json({ ok: false, error: 'validation' });
  }
  db.prepare('INSERT INTO contact_messages (name,contact,message,created_at) VALUES (?,?,?,?)')
    .run(name, contact, message, nowIso());
  res.status(201).json({ ok: true });
});

/* ------------------------------------------------------------------ *
 *  Admin API
 * ------------------------------------------------------------------ */

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const pw = String((req.body || {}).password || '');
  const ok = pw.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ ok: false, error: 'bad_password' });
  res.cookie('wink_admin', signToken(), {
    httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000,
    secure: String(process.env.SECURE_COOKIE || 'false') === 'true'
  });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('wink_admin');
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => res.json({ ok: verifyToken(req.cookies.wink_admin) }));

app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const status = clean(req.query.status, 20);
  const from = clean(req.query.from, 10);
  const to = clean(req.query.to, 10);
  const q = clean(req.query.q, 60);

  const where = [];
  const args = [];
  if (status && status !== 'all') { where.push('status = ?'); args.push(status); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('date >= ?'); args.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('date <= ?'); args.push(to); }
  if (q) { where.push('(name LIKE ? OR phone LIKE ? OR code LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q.toUpperCase()}%`); }

  const sql = `SELECT * FROM bookings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY start_at DESC LIMIT 500`;
  res.json({ ok: true, bookings: db.prepare(sql).all(...args) });
});

app.patch('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const allowed = ['pending', 'confirmed', 'seated', 'cancelled', 'no_show'];
  const body = req.body || {};
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ ok: false, error: 'not_found' });

  if (body.status) {
    if (!allowed.includes(body.status)) return res.status(400).json({ ok: false, error: 'bad_status' });
    db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?').run(body.status, nowIso(), id);
  }
  if (typeof body.notes === 'string') {
    db.prepare('UPDATE bookings SET notes = ?, updated_at = ? WHERE id = ?').run(clean(body.notes, 400), nowIso(), id);
  }
  res.json({ ok: true, booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) });
});

app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM bookings WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const today = T.fmtDate(new Date());
  const in7 = T.fmtDate(new Date(Date.now() + 7 * 864e5));
  const one = (sql, ...a) => db.prepare(sql).get(...a);

  res.json({
    ok: true,
    stats: {
      todayCount: one("SELECT COUNT(*) c FROM bookings WHERE date = ? AND status IN ('pending','confirmed','seated')", today).c,
      todayGuests: one("SELECT COALESCE(SUM(guests),0) g FROM bookings WHERE date = ? AND status IN ('pending','confirmed','seated')", today).g,
      pending: one("SELECT COUNT(*) c FROM bookings WHERE status = 'pending' AND date >= ?", today).c,
      upcoming7: one("SELECT COUNT(*) c FROM bookings WHERE date BETWEEN ? AND ? AND status IN ('pending','confirmed')", today, in7).c,
      total: one('SELECT COUNT(*) c FROM bookings').c,
      byArea: db.prepare(`SELECT area, COUNT(*) c, COALESCE(SUM(guests),0) g FROM bookings
                          WHERE date >= ? AND status IN ('pending','confirmed','seated')
                          GROUP BY area`).all(today),
      byDay: db.prepare(`SELECT date, COUNT(*) c, COALESCE(SUM(guests),0) g FROM bookings
                         WHERE date BETWEEN ? AND ? AND status IN ('pending','confirmed','seated')
                         GROUP BY date ORDER BY date`).all(today, in7),
      messages: one('SELECT COUNT(*) c FROM contact_messages WHERE handled = 0').c
    }
  });
});

app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookings ORDER BY start_at DESC').all();
  const head = ['code', 'name', 'phone', 'email', 'date', 'time', 'guests', 'area', 'occasion', 'shisha_count', 'status', 'notes', 'created_at'];
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [head.join(',')].concat(rows.map((r) => head.map((h) => esc(r[h])).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="wink-bookings-${T.fmtDate(new Date())}.csv"`);
  res.send(csv);
});

app.get('/api/admin/messages', requireAdmin, (req, res) => {
  res.json({ ok: true, messages: db.prepare('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 200').all() });
});

app.post('/api/admin/messages/:id/handled', requireAdmin, (req, res) => {
  db.prepare('UPDATE contact_messages SET handled = 1 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

/* Matches shown on the public site */
app.get('/api/admin/matches', requireAdmin, (req, res) => {
  res.json({ ok: true, matches: db.prepare('SELECT * FROM matches ORDER BY kickoff DESC LIMIT 100').all() });
});

app.post('/api/admin/matches', requireAdmin, (req, res) => {
  const b = req.body || {};
  const competition = clean(b.competition, 60);
  const teamA = clean(b.teamA, 40);
  const teamB = clean(b.teamB, 40);
  const kickoff = clean(b.kickoff, 16).replace('T', ' ');
  if (!competition || !teamA || !teamB || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(kickoff)) {
    return res.status(400).json({ ok: false, error: 'validation' });
  }
  const info = db.prepare('INSERT INTO matches (competition,team_a,team_b,kickoff,note,created_at) VALUES (?,?,?,?,?,?)')
    .run(competition, teamA, teamB, kickoff, clean(b.note, 120) || null, nowIso());
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

app.delete('/api/admin/matches/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM matches WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

/* Closed days */
app.get('/api/admin/blackouts', requireAdmin, (req, res) => {
  res.json({ ok: true, blackouts: db.prepare('SELECT * FROM blackouts ORDER BY date').all() });
});

app.post('/api/admin/blackouts', requireAdmin, (req, res) => {
  const date = clean((req.body || {}).date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'bad_date' });
  db.prepare('INSERT OR IGNORE INTO blackouts (date, reason) VALUES (?,?)')
    .run(date, clean((req.body || {}).reason, 120) || null);
  res.status(201).json({ ok: true });
});

app.delete('/api/admin/blackouts/:date', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM blackouts WHERE date = ?').run(clean(req.params.date, 10));
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 *  Static site
 * ------------------------------------------------------------------ */

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'not_found' });
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ☕  ${cafe.nameEn} — http://localhost:${PORT}`);
  console.log(`  🔐  Admin dashboard — http://localhost:${PORT}/admin  (password: ${process.env.ADMIN_PASSWORD ? '••••••' : ADMIN_PASSWORD})`);
  console.log(`  ✉️   Email notifications: ${mailEnabled() ? 'enabled' : 'disabled (set SMTP_* in .env)'}\n`);
});
