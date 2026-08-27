'use strict';

const nodemailer = require('nodemailer');
const { cafe, areas } = require('./config');

let transporter = null;
let enabled = false;

if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  enabled = true;
} else {
  console.log('[mail] SMTP not configured — email notifications are disabled (bookings still save + WhatsApp still works).');
}

const areaName = (id, lang) => {
  const a = areas.find((x) => x.id === id);
  if (!a) return id;
  return lang === 'en' ? a.nameEn : a.nameAr;
};

function row(label, value) {
  return `<tr><td style="padding:8px 14px;color:#8b7355;font-size:13px;white-space:nowrap">${label}</td>
          <td style="padding:8px 14px;color:#1c1917;font-size:15px;font-weight:600">${value}</td></tr>`;
}

function bookingHtml(b, forAdmin) {
  const ar = b.lang !== 'en';
  const dir = ar ? 'rtl' : 'ltr';
  const title = forAdmin
    ? (ar ? 'حجز جديد على الموقع' : 'New reservation from the website')
    : (ar ? `تم استلام حجزك في ${cafe.nameAr}` : `Your reservation at ${cafe.nameEn}`);
  const intro = forAdmin
    ? (ar ? 'وصل حجز جديد، بتلاقي التفاصيل تحت:' : 'A new reservation just came in:')
    : (ar
        ? `أهلاً ${b.name}، استلمنا طلب حجزك وحنأكده معك على الواتساب قريباً.`
        : `Hi ${b.name}, we received your reservation and will confirm it on WhatsApp shortly.`);

  return `<div dir="${dir}" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#f6f2ec;padding:28px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e7ded1">
    <div style="background:#2b1d12;padding:26px 24px;text-align:center">
      <div style="color:#e8c07d;font-size:13px;letter-spacing:3px;text-transform:uppercase">${ar ? cafe.nameAr : cafe.nameEn}</div>
      <div style="color:#fff;font-size:21px;font-weight:700;margin-top:6px">${title}</div>
    </div>
    <div style="padding:22px 24px">
      <p style="color:#57534e;font-size:15px;line-height:1.7;margin:0 0 14px">${intro}</p>
      <div style="background:#faf7f2;border:1px solid #ece3d6;border-radius:14px;padding:6px 0;margin-bottom:16px">
        <table style="width:100%;border-collapse:collapse">
          ${row(ar ? 'رقم الحجز' : 'Code', `<span style="letter-spacing:1px">${b.code}</span>`)}
          ${row(ar ? 'الاسم' : 'Name', b.name)}
          ${row(ar ? 'الهاتف' : 'Phone', b.phone)}
          ${row(ar ? 'التاريخ' : 'Date', b.date)}
          ${row(ar ? 'الوقت' : 'Time', b.time)}
          ${row(ar ? 'عدد الأشخاص' : 'Guests', b.guests)}
          ${row(ar ? 'القسم' : 'Area', areaName(b.area, ar ? 'ar' : 'en'))}
          ${b.shisha ? row(ar ? 'أرجيلة' : 'Shisha', `${b.shisha_count} ${ar ? 'أرجيلة' : 'head(s)'}`) : ''}
          ${b.notes ? row(ar ? 'ملاحظات' : 'Notes', String(b.notes).replace(/</g, '&lt;')) : ''}
        </table>
      </div>
      <p style="color:#8b7355;font-size:13px;line-height:1.7;margin:0">
        ${ar
          ? `الحجز بيضل محجوز ١٥ دقيقة بعد الوقت المحدد. لأي تعديل اتصل على ${cafe.phoneDisplay}.`
          : `We hold your table for 15 minutes past the booked time. To change anything, call ${cafe.phoneDisplay}.`}
      </p>
    </div>
    <div style="background:#faf7f2;padding:14px 24px;text-align:center;color:#a8a29e;font-size:12px;border-top:1px solid #ece3d6">
      ${cafe.nameEn} · ${cafe.cityEn} · ${cafe.phoneDisplay}
    </div>
  </div>
</div>`;
}

async function sendBookingMails(b) {
  if (!enabled) return { sent: false, reason: 'smtp-not-configured' };
  const from = process.env.MAIL_FROM || `"${cafe.nameEn}" <${process.env.SMTP_USER}>`;
  const adminTo = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
  const jobs = [];

  jobs.push(transporter.sendMail({
    from,
    to: adminTo,
    subject: `🔔 حجز جديد ${b.code} — ${b.date} ${b.time} — ${b.guests} أشخاص`,
    html: bookingHtml(b, true)
  }));

  if (b.email) {
    jobs.push(transporter.sendMail({
      from,
      to: b.email,
      subject: b.lang === 'en' ? `${cafe.nameEn} — reservation ${b.code}` : `${cafe.nameAr} — حجزك رقم ${b.code}`,
      html: bookingHtml(b, false)
    }));
  }

  try {
    await Promise.all(jobs);
    return { sent: true };
  } catch (err) {
    console.error('[mail] send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendBookingMails, mailEnabled: () => enabled };
