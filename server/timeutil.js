'use strict';

const { cafe, SLOT_HOLD_MINUTES } = require('./config');

const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" + "HH:MM" -> Date, rolling over to the next day for after-midnight slots. */
function toDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (hh < cafe.openHour) dt.setDate(dt.getDate() + 1); // 00:30 belongs to the night of `dateStr`
  return dt;
}

function fmt(dt) {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function fmtDate(dt) {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function addMinutes(dt, mins) {
  const x = new Date(dt.getTime());
  x.setMinutes(x.getMinutes() + mins);
  return x;
}

/** Every bookable 30-minute slot, from opening until one hour before closing.
 *  closeHour may be on the following day (0 = midnight, 2 = 2 AM, ...). */
function allSlots() {
  const openMin = cafe.openHour * 60;
  const closeH = cafe.closeHour <= cafe.openHour ? cafe.closeHour + 24 : cafe.closeHour;
  const lastMin = closeH * 60 - 60; // last table can still be seated an hour before closing

  const slots = [];
  for (let m = openMin; m <= lastMin; m += 30) {
    slots.push(`${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`);
  }
  return slots;
}

/** Slots still bookable for a given date, honouring the minimum lead time. */
function availableSlotLabels(dateStr, minLeadMinutes) {
  const now = new Date();
  const cutoff = addMinutes(now, minLeadMinutes);
  return allSlots().filter((label) => toDateTime(dateStr, label) >= cutoff);
}

function bookingWindow(dateStr, timeStr) {
  const start = toDateTime(dateStr, timeStr);
  const end = addMinutes(start, SLOT_HOLD_MINUTES);
  return { start, end, startStr: fmt(start), endStr: fmt(end) };
}

module.exports = { pad, toDateTime, fmt, fmtDate, addMinutes, allSlots, availableSlotLabels, bookingWindow };
