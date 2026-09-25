// ฟังก์ชันช่วยจัดรูปแบบ ใช้ได้ทั้งใน route และ view (ผ่าน app.locals)

const pad2 = (n) => String(n).padStart(2, '0');

// '2026-09-24' หรือ '2026-09-24 09:30:00' → '24/09/2026'
function fmtDate(v) {
  if (!v) return '-';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}

// '09:30:00' หรือ '2026-09-24 09:30:00' → '09:30'
function fmtTime(v) {
  if (!v) return '-';
  const m = String(v).match(/(\d{2}):(\d{2})(?::\d{2})?$/);
  return m ? `${m[1]}:${m[2]}` : String(v);
}

function fmtDateTime(v) {
  if (!v) return '-';
  return `${fmtDate(v)} ${fmtTime(v)}`;
}

// วันนี้ตามเวลาเครื่อง server เป็น YYYY-MM-DD
function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// เพิ่มนาทีให้เวลา 'HH:MM[:SS]' → 'HH:MM'
function addMinutes(time, minutes) {
  const [h, m] = String(time).split(':').map(Number);
  const total = h * 60 + m + Number(minutes || 0);
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}

const DAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

// สถานะ → สี Badge (ข้อความแสดงคู่กับสีเสมอ ไม่สื่อด้วยสีอย่างเดียว)
const BADGE = {
  'ยืนยัน': 'success',
  'Check-in แล้ว': 'success',
  'ยกเลิก': 'danger',
  'No Show': 'warning',
  'เปิด': 'info',
  'กำลังเดินทาง': 'accent',
  'เสร็จสิ้น': 'neutral',
  'พร้อมใช้งาน': 'success',
  'ซ่อมบำรุง': 'warning',
  'ไม่พร้อมใช้งาน': 'danger',
  'ที่นั่งเต็ม': 'danger',
};

function badge(status) {
  const tone = BADGE[status] || 'neutral';
  return `<span class="badge badge-${tone}">${escapeHtml(status)}</span>`;
}

// สถานะที่แสดงของรายการจอง: มี Check-in = "Check-in แล้ว"
function itemStatus(item) {
  if (item.checkin_at && item.status === 'ยืนยัน') return 'Check-in แล้ว';
  return item.status;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// สร้าง query string จาก object (ข้ามค่าว่าง)
function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

module.exports = {
  fmtDate, fmtTime, fmtDateTime, today, addMinutes, DAY_NAMES,
  badge, itemStatus, escapeHtml, qs,
};
