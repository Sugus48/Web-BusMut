// สร้างรอบการเดินรถของแต่ละวันล่วงหน้าจากตารางเวลาเดินรถประจำ (trip_schedules)
// - ข้ามวัน/ตารางเวลาที่มีรอบอยู่แล้ว (รวมรอบที่ถูกยกเลิก จึงไม่สร้างรอบที่ admin ยกเลิกกลับมา)
// - สร้างเฉพาะวันที่ตรงกับวันที่วิ่งของตารางเวลา (run_days เช่น จันทร์–ศุกร์)
// - สร้างครบทุกรอบของวันนี้แม้เลยเวลาออกแล้ว — คนขับเห็นงานทั้งวัน (การจองยังปิดตามกฎ 20 นาที)
// - รถไม่พร้อมใช้งาน / รถหรือคนขับชนเวลา (trigger ปฏิเสธ) → ข้ามรอบนั้น
const db = require('../db');
const { today } = require('./helpers');

const DAYS_AHEAD = 8;  // วันนี้ + 7 วัน
const MAX_DAYS = 60;   // สร้างให้เมื่อค้นหาวันที่ไกลสุดไม่เกินนี้

const pad2 = (n) => String(n).padStart(2, '0');

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

// 0 = อาทิตย์ … 6 = เสาร์ (ตรงกับ trip_schedules.run_days)
function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

// ชุดวันที่วิ่งที่เลือกได้ในหน้าตารางเวลาเดินรถ
const RUN_DAYS = [
  { value: '12345', label: 'จันทร์–ศุกร์ (วันทำการ)' },
  { value: '123456', label: 'จันทร์–เสาร์' },
  { value: '0123456', label: 'ทุกวัน' },
  { value: '06', label: 'เสาร์–อาทิตย์' },
];
const runDaysLabel = (v) => (RUN_DAYS.find((o) => o.value === String(v)) || { label: v }).label;

async function generate(from, days) {
  const first = from < today() ? today() : from;
  const last = [addDays(from, days - 1), addDays(today(), MAX_DAYS)].sort()[0];
  if (first > last) return 0;

  const schedules = await db.query(
    `SELECT schedule_id, route_id, depart_time, vehicle_id, driver_id, run_days
       FROM trip_schedules WHERE active = 1 ORDER BY depart_time, route_id`,
  );
  if (!schedules.length) return 0;

  const existing = await db.query(
    'SELECT trip_date, route_id, depart_time, schedule_id FROM trips WHERE trip_date BETWEEN ? AND ?',
    [first, last],
  );
  const has = new Set();
  for (const t of existing) {
    has.add(`${t.trip_date}|${t.route_id}|${t.depart_time}`);
    if (t.schedule_id) has.add(`${t.trip_date}|${t.schedule_id}`);
  }

  let created = 0;
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const day = String(weekday(date));
    for (const s of schedules) {
      if (!String(s.run_days).includes(day)) continue;
      if (has.has(`${date}|${s.schedule_id}`) || has.has(`${date}|${s.route_id}|${s.depart_time}`)) continue;
      try {
        const id = await db.nextId('trips', 'trip_id', 'TR', 3);
        await db.insert('trips', {
          trip_id: id, trip_date: date, depart_time: s.depart_time, status: 'เปิด',
          vehicle_id: s.vehicle_id, route_id: s.route_id, driver_id: s.driver_id, schedule_id: s.schedule_id,
        });
        created += 1;
      } catch (err) {
        if (err.sqlState !== '45000') throw err;
        console.warn(`ข้ามตารางเวลา ${s.schedule_id} วันที่ ${date}: ${err.sqlMessage}`);
      }
    }
  }
  return created;
}

// ลบรอบล่วงหน้าของตารางเวลาที่ยังไม่มีการจอง
function removeUpcoming(scheduleId) {
  return db.query(
    `DELETE FROM trips
      WHERE schedule_id = ? AND status = 'เปิด' AND TIMESTAMP(trip_date, depart_time) > NOW()
        AND NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.trip_id = trips.trip_id)`,
    [scheduleId],
  );
}

// ทำทีละงาน — เรียกพร้อมกันหลายที่ (เปิดเว็บ/ตั้งเวลา/ค้นหา/แก้ตารางเวลา) จะไม่สร้างรอบซ้ำ
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

const ensureTrips = (from = today(), days = DAYS_AHEAD) => enqueue(() => generate(from, days));

// หลังเพิ่ม/แก้/หยุดใช้งานตารางเวลา: ลบรอบล่วงหน้าที่ยังไม่มีคนจองแล้วสร้างใหม่ตามค่าล่าสุด
// (รอบที่มีการจองแล้วคงไว้ตามเดิม — แก้รายรอบได้ที่หน้ารอบการเดินรถ)
const refreshSchedule = (scheduleId) => enqueue(async () => {
  await removeUpcoming(scheduleId);
  return generate(today(), DAYS_AHEAD);
});

// ก่อนลบตารางเวลา: ลบรอบล่วงหน้าที่ยังไม่มีคนจอง
const dropSchedule = (scheduleId) => enqueue(() => removeUpcoming(scheduleId));

module.exports = { ensureTrips, refreshSchedule, dropSchedule, MAX_DAYS, RUN_DAYS, runDaysLabel };
