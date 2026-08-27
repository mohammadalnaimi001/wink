'use strict';

/* ============================================================
   Wink Cafe — Central configuration
   Edit this file to change café details, areas, and capacity.
   ============================================================ */

const cafe = {
  nameAr: 'وينك كافيه',
  nameEn: 'Wink Cafe',
  taglineAr: 'قهوة، أرجيلة، وأجواء ما بتنتسى — في قلب الزرقاء',
  taglineEn: 'Coffee, shisha, and unforgettable nights — in the heart of Zarqa',
  rating: 3.9,
  reviewsCount: 1638,
  priceRangeAr: '٥ – ١٠ د.أ للشخص',
  priceRangeEn: '5 – 10 JOD per person',
  phoneDisplay: '079 580 5249',
  phoneIntl: '962795805249',
  email: 'info@winkcafe.jo',
  cityAr: 'الزرقاء، الأردن',
  cityEn: 'Zarqa, Jordan',
  streetAr: 'شارع الأميرة هيا',
  streetEn: 'Princess Haya St',
  plusCode: '432V+3WR',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Wink+Cafe+Princess+Haya+St+Zarqa',
  mapsEmbed: 'https://maps.google.com/maps?q=432V%2B3WR%20Zarqa&t=&z=16&ie=UTF8&iwloc=&output=embed',
  // ← راجع هذا الرابط: تأكد إن الكافيه فعلاً على طلبات، وإلا احذف أزرار الطلب من الموقع
  talabatUrl: 'https://www.talabat.com/jordan',
  instagram: 'https://www.instagram.com/',

  // ساعات العمل: بيفتح ١٠ ص (حسب خرائط جوجل).
  // ← وقت الإغلاق غير مذكور على جوجل — حطّينا منتصف الليل مؤقتاً، غيّره لوقتك الحقيقي.
  openHour: 10,
  closeHour: 0, // 0 = منتصف الليل. مثال: 2 يعني ٢ فجراً، 23 يعني ١١ مساءً
  bookingPrefix: 'WK', // بادئة رقم الحجز، مثال: WK-A7X2QM
  currencyAr: 'د.أ',
  currencyEn: 'JOD'
};

/* Bookable areas. capacity = total seats available at any one time. */
const areas = [
  {
    id: 'indoor',
    nameAr: 'الصالة الداخلية',
    nameEn: 'Indoor Lounge',
    descAr: 'جلسات مريحة، تكييف، وأجواء هادئة — مثالية للشغل والدراسة والقعدات الطويلة.',
    descEn: 'Comfortable seating, air-conditioned and calm — ideal for work, study and long sit-downs.',
    capacity: 60,
    shisha: false,
    icon: 'sofa'
  },
  {
    id: 'terrace',
    nameAr: 'التراس الخارجي',
    nameEn: 'Outdoor Terrace',
    descAr: 'هوا الزرقاء وأرجيلة على المزاج — القسم الأكثر طلباً بعد المغرب.',
    descEn: 'Fresh Zarqa air and shisha the way you like it — our most requested area after sunset.',
    capacity: 45,
    shisha: true,
    icon: 'leaf'
  },
  {
    id: 'match',
    nameAr: 'ركن المباريات',
    nameEn: 'Match Corner',
    descAr: 'شاشات كبيرة وصوت عالي — كل المباريات المهمة بتنعرض هون مباشر.',
    descEn: 'Big screens and full sound — every big match streamed live right here.',
    capacity: 40,
    shisha: true,
    icon: 'tv'
  },
  {
    id: 'private',
    nameAr: 'الجلسة الخاصة',
    nameEn: 'Private Booth',
    descAr: 'ركن مسكّر للمناسبات والاجتماعات وأعياد الميلاد — حجز مسبق ضروري.',
    descEn: 'A closed-off corner for occasions, meetings and birthdays — advance booking required.',
    capacity: 24,
    shisha: true,
    icon: 'star'
  }
];

const occasions = [
  { id: 'casual',   nameAr: 'قعدة عادية',        nameEn: 'Casual visit' },
  { id: 'match',    nameAr: 'مشاهدة مباراة',     nameEn: 'Watching a match' },
  { id: 'birthday', nameAr: 'عيد ميلاد',          nameEn: 'Birthday' },
  { id: 'business', nameAr: 'اجتماع عمل',         nameEn: 'Business meeting' },
  { id: 'family',   nameAr: 'قعدة عائلية',        nameEn: 'Family gathering' }
];

/* A reservation is assumed to hold its seats for this many minutes. */
const SLOT_HOLD_MINUTES = 120;
/* Reservations can be made this many days ahead. */
const MAX_DAYS_AHEAD = 60;
/* Minimum minutes ahead of now that a booking can be made. */
const MIN_LEAD_MINUTES = 45;

module.exports = { cafe, areas, occasions, SLOT_HOLD_MINUTES, MAX_DAYS_AHEAD, MIN_LEAD_MINUTES };
