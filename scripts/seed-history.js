// เติมข้อมูลย้อนหลังสำหรับรายงาน ด้วยคำสั่ง INSERT โดยตรง
// (รอบเดินรถที่เสร็จสิ้น + การจอง + Check-in / No Show / ยกเลิก + ผู้ใช้ตัวอย่างนักศึกษา 12 คน รหัสผ่าน 1234)
// - สร้างรอบตามตารางเวลาเดินรถ (trip_schedules) ทุกวันที่วิ่ง ตั้งแต่ 1 ม.ค. ถึงเมื่อวานของปีที่เลือก
// - ช่วงเวลาที่มีรอบอยู่แล้วจะข้าม (รอบในอดีตที่ยัง "เปิด" และไม่มีคนจองจะถูกลบก่อนเติม)
// - สุ่มแบบกำหนด seed ตามปี และข้ามถ้าปีนั้นเคยเติมแล้ว
// - --sql : บันทึกคำสั่ง INSERT ที่รันจริงเป็นไฟล์ database/history_<ปี พ.ศ.>.sql (MySQL) และ _oracle.sql
//   --reset : ลบข้อมูลที่เคยเติมของปีนั้นก่อน แล้วสร้างใหม่
// ใช้:  npm run db:history                       (ปีที่แล้ว + ปีนี้)
//       npm run db:history -- 2569 --sql         (ระบุปี พ.ศ. หรือ ค.ศ.)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const db = require('../src/db');
const { today } = require('../src/lib/helpers');

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hms = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}:00`;
const toMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const HIST_QR = 'QR-%-HIST%'; // qr_code ของรายการที่สคริปต์นี้สร้าง

// PRNG แบบกำหนด seed (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickWeighted = (rand, items, weight) => {
  let r = rand() * items.reduce((n, x) => n + weight(x), 0);
  for (const x of items) { r -= weight(x); if (r <= 0) return x; }
  return items[items.length - 1];
};

// ความหนาแน่นผู้โดยสารรายเดือน (ม.ค.–ธ.ค.) — ปิดภาคเรียน เม.ย. น้อยสุด, ปลายปีมากสุด
const MONTH_FACTOR = [0.65, 0.72, 0.75, 0.6, 0.8, 0.78, 0.88, 0.95, 0.9, 1.0, 0.97, 1.05];
// น้ำหนักจุดจอด — มหาวิทยาลัยมีคนขึ้นลงมากที่สุด
const STOP_WEIGHT = { S001: 5, S002: 2.6, S003: 2.2, S004: 1.8, S005: 1.2, S006: 0.9 };

const STUDENTS = [
  'กิตติพงษ์ แสงทอง', 'ชนิดา วงศ์ใหญ่', 'ณัฐวุฒิ ศรีสุข', 'ธนพร จันทร์เพ็ญ', 'ปิยะพงษ์ ทองดี', 'พิมพ์ชนก สายสุวรรณ',
  'ภาณุวัฒน์ บุญมา', 'วรรณิศา มณีรัตน์', 'ศุภชัย พรหมมา', 'สุภาวดี แก้วกล้า', 'อนุชา ใจเย็น', 'อรอุมา รุ่งเรือง',
];

// ค่าคงที่ใน SQL แยกตามฐานข้อมูล
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const LIT = {
  mysql: { date: (d) => q(d), datetime: (d, t) => q(`${d} ${t}`) },
  oracle: { date: (d) => `DATE ${q(d)}`, datetime: (d, t) => `TO_DATE(${q(`${d} ${t}`)}, 'YYYY-MM-DD HH24:MI:SS')` },
};
// values: { col: string | number | null | ['date', d] | ['datetime', d, t] }
function insertSql(dialect, table, values) {
  const lit = (v) => {
    if (v === null) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return LIT[dialect][v[0]](...v.slice(1));
    return q(v);
  };
  return `INSERT INTO ${table} (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).map(lit).join(', ')})`;
}

function parseYear(arg) {
  const y = Number(arg);
  if (!y) return Number(today().slice(0, 4)) - 1;
  return y > 2400 ? y - 543 : y;
}

const maxNum = async (table, col, prefix) => {
  const rows = await db.query(`SELECT ${col} AS id FROM ${table}`);
  return rows.reduce((n, r) => {
    const m = String(r.id).match(new RegExp(`^${prefix}(\\d+)$`));
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);
};

async function reset(from, to) {
  await db.query(
    `DELETE FROM booking_items WHERE qr_code LIKE ? AND trip_id IN (SELECT trip_id FROM trips WHERE trip_date BETWEEN ? AND ?)`,
    [HIST_QR, from, to],
  );
  await db.query('DELETE FROM bookings WHERE NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = bookings.booking_id)');
  await db.query(
    `DELETE FROM trips WHERE trip_date BETWEEN ? AND ? AND status = 'เสร็จสิ้น'
        AND NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.trip_id = trips.trip_id)`,
    [from, to],
  );
}

async function main(yearArg, { sql = false, resetFirst = false } = {}) {
  const year = parseYear(yearArg);
  const be = year + 543;
  const from = `${year}-01-01`;
  const to = [`${year}-12-31`, today(-1)].sort()[0];
  if (to < from) { console.log(`ปี ${be} ยังไม่ถึง — ไม่มีอะไรให้เติม`); return; }

  if (resetFirst) await reset(from, to);
  const [{ n: done }] = await db.query(
    'SELECT COUNT(*) AS n FROM booking_items bi JOIN trips t ON t.trip_id = bi.trip_id WHERE bi.qr_code LIKE ? AND t.trip_date BETWEEN ? AND ?',
    [HIST_QR, from, to],
  );
  if (Number(done) > 0) { console.log(`ปี ${be} เติมข้อมูลไว้แล้ว — ข้าม (ใช้ --reset เพื่อสร้างใหม่)`); return; }

  // คำสั่งที่รันสำเร็จ เก็บไว้ทั้ง 2 แบบสำหรับเขียนไฟล์
  const log = { mysql: [], oracle: [] };
  const run = async (build, conn) => {
    const text = { mysql: build('mysql'), oracle: build('oracle') };
    await db.query(text[db.client], [], conn);
    log.mysql.push(text.mysql);
    log.oracle.push(text.oracle);
  };

  // รอบในอดีตที่ยัง "เปิด" และไม่มีคนจอง (ระบบสร้างล่วงหน้าไว้แต่ไม่มีใครใช้) → ลบ เพื่อเติมเป็นรอบที่เสร็จสิ้น
  await run((d) => `DELETE FROM trips WHERE trip_date BETWEEN ${LIT[d].date(from)} AND ${LIT[d].date(to)} AND status = 'เปิด'
   AND NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.trip_id = trips.trip_id)`);

  // ผู้ใช้ตัวอย่าง (นักศึกษา)
  const hash = crypto.createHash('sha256').update('1234', 'utf8').digest('hex');
  if (!(await db.one("SELECT department_id FROM departments WHERE department_id = 'D003'"))) {
    await run((d) => insertSql(d, 'departments', { department_id: 'D003', department_name: 'นักศึกษา' }));
  }
  // เขียนลงไฟล์ทุกครั้งแบบ "เพิ่มถ้ายังไม่มี" — ไฟล์ SQL แต่ละปีรันเองได้ และรันต่อกันหลายปีไม่ซ้ำ
  const users = [];
  let userNo = await maxNum('users', 'user_id', 'U');
  for (let i = 0; i < STUDENTS.length; i += 1) {
    const username = `student${pad2(i + 1)}`;
    const found = await db.one('SELECT user_id FROM users WHERE username = ?', [username]);
    const id = found ? found.user_id : `U${String((userNo += 1)).padStart(3, '0')}`;
    await run(() => `INSERT INTO users (user_id, name, email, username, password_hash, department_id)
  SELECT ${[id, STUDENTS[i], `${username}@mail.com`, username, hash, 'D003'].map(q).join(', ')} FROM dual
   WHERE NOT EXISTS (SELECT 1 FROM users WHERE user_id = ${q(id)} OR username = ${q(username)})`);
    users.push(id);
  }
  users.push(...(await db.query("SELECT user_id FROM users WHERE username = 'manee'")).map((u) => u.user_id));

  const schedules = await db.query(
    `SELECT s.schedule_id, s.route_id, s.depart_time, s.vehicle_id, s.driver_id, s.run_days, vt.seat_count
       FROM trip_schedules s
       JOIN vehicles v       ON v.vehicle_id = s.vehicle_id
       JOIN vehicle_types vt ON vt.vehicle_type_id = v.vehicle_type_id
      WHERE s.active = 1 ORDER BY s.depart_time, s.route_id`,
  );
  const routeStops = await db.query('SELECT route_id, stop_order, stop_id, travel_minutes FROM route_stops ORDER BY route_id, stop_order');
  const stopsOf = {};
  for (const rs of routeStops) {
    const list = (stopsOf[rs.route_id] ||= []);
    const prev = list[list.length - 1];
    list.push({ stop_id: rs.stop_id, cum: (prev ? prev.cum : 0) + Number(rs.travel_minutes) });
  }
  // ช่วงเวลาที่มีรอบอยู่แล้ว → ข้าม
  const taken = new Set();
  for (const t of await db.query('SELECT trip_date, schedule_id, route_id, depart_time FROM trips WHERE trip_date BETWEEN ? AND ?', [from, to])) {
    const date = String(t.trip_date).slice(0, 10);
    taken.add(`${date}|${t.schedule_id}`);
    taken.add(`${date}|${t.route_id}|${t.depart_time}`);
  }

  const rand = rng(year);
  let tripNo = await maxNum('trips', 'trip_id', 'TR');
  let bookingNo = await maxNum('bookings', 'booking_id', 'B');
  let itemNo = await maxNum('booking_items', 'booking_item_id', 'BD');
  const totals = { trips: 0, items: 0 };
  const monthMarks = []; // ตำแหน่งใน log ที่จบแต่ละเดือน (ใส่ COMMIT ในไฟล์)

  // ทีละเดือนในหนึ่ง transaction
  for (let month = 0; month < 12; month += 1) {
    const days = [];
    for (let d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate() + 1)) {
      if (ymd(d) <= to) days.push(new Date(d));
    }
    if (!days.length) break;

    await db.tx(async (conn) => {
      for (const day of days) {
        const date = ymd(day);
        for (const s of schedules) {
          if (!String(s.run_days).includes(String(day.getDay()))) continue;
          if (taken.has(`${date}|${s.schedule_id}`) || taken.has(`${date}|${s.route_id}|${s.depart_time}`)) continue;
          let tripId;
          let skip = false;
          // รหัสซ้ำ (เว็บที่เปิดอยู่สร้างรอบล่วงหน้าไปแล้ว) → ขยับไปรหัสถัดไป
          for (;;) {
            tripId = `TR${String(tripNo + 1).padStart(3, '0')}`;
            try {
              await run((d) => insertSql(d, 'trips', {
                trip_id: tripId, trip_date: ['date', date], depart_time: s.depart_time, status: 'เสร็จสิ้น',
                vehicle_id: s.vehicle_id, route_id: s.route_id, driver_id: s.driver_id, schedule_id: s.schedule_id,
              }), conn);
              break;
            } catch (err) {
              if (err.errno === 1062) { tripNo += 1; continue; }
              if (err.sqlState !== '45000') throw err; // รถ/คนขับชนกับรอบที่มีอยู่ → ข้าม
              skip = true;
              break;
            }
          }
          if (skip) continue;
          tripNo += 1;
          totals.trips += 1;

          // จำนวนที่นั่งที่จองต่อรอบ ~ 30–65% ของความจุ ตามฤดูกาล
          const stops = stopsOf[s.route_id];
          const target = Math.round(Number(s.seat_count) * MONTH_FACTOR[month] * (0.3 + rand() * 0.35));
          let used = 0;
          while (used < target) {
            const seats = Math.min(target - used, rand() < 0.75 ? 1 : rand() < 0.8 ? 2 : 3);
            // จุดขึ้นก่อนจุดลงในเส้นทาง
            const bi = stops.indexOf(pickWeighted(rand, stops.slice(0, -1), (x) => STOP_WEIGHT[x.stop_id] || 1));
            const ai = stops.indexOf(pickWeighted(rand, stops.slice(bi + 1).filter((x) => x.stop_id !== stops[bi].stop_id),
              (x) => STOP_WEIGHT[x.stop_id] || 1));
            if (ai < 0) continue;
            const r = rand();
            const status = r < 0.06 ? 'ยกเลิก' : r < 0.13 ? 'No Show' : 'ยืนยัน';
            if (status !== 'ยกเลิก') used += seats;

            bookingNo += 1;
            itemNo += 1;
            const bookingId = `B${String(bookingNo).padStart(3, '0')}`;
            const itemId = `BD${String(itemNo).padStart(3, '0')}`;
            const before = new Date(day);
            before.setDate(before.getDate() - 1 - Math.floor(rand() * 3));
            const bookedAt = ['datetime', ymd(before), hms(7 * 60 + Math.floor(rand() * 14 * 60))];
            const user = users[Math.floor(rand() * users.length)];
            const boardAt = toMinutes(s.depart_time) + stops[bi].cum + Math.floor(rand() * 3);
            await run((d) => insertSql(d, 'bookings', { booking_id: bookingId, booked_at: bookedAt, user_id: user }), conn);
            await run((d) => insertSql(d, 'booking_items', {
              booking_item_id: itemId, qr_code: `QR-${itemId}-HIST${String(itemNo).padStart(4, '0')}`, status, seats,
              checkin_at: status === 'ยืนยัน' ? ['datetime', date, hms(boardAt)] : null,
              booking_id: bookingId, trip_id: tripId, board_stop_id: stops[bi].stop_id, alight_stop_id: stops[ai].stop_id,
            }), conn);
            totals.items += 1;
          }
        }
      }
    });
    monthMarks.push(log.mysql.length);
    process.stdout.write(`\r  เติมข้อมูลปี ${be}: เดือน ${month + 1}/12 `);
  }
  console.log(`\n✓ ข้อมูลย้อนหลังปี ${be} (ถึง ${to}): ${totals.trips} รอบ, ${totals.items} รายการจอง`);

  if (sql) {
    for (const d of ['mysql', 'oracle']) {
      const file = path.join(__dirname, '..', 'database', `history_${be}${d === 'oracle' ? '_oracle' : ''}.sql`);
      const lines = [
        '-- =====================================================================',
        `--  ข้อมูลย้อนหลังปี ${be} สำหรับออกรายงาน (${d === 'oracle' ? 'Oracle' : 'MySQL'}) — ${totals.trips} รอบ, ${totals.items} รายการจอง`,
        `--  ข้อมูลวันที่ ${from} ถึง ${to} สร้างจาก scripts/seed-history.js เมื่อ ${today()}`,
        `--  รันหลัง ${d === 'oracle' ? 'mut_shuttle_oracle.sql + demo_data_oracle.sql' : 'mut_shuttle.sql + demo_data.sql'} (รหัสต่อจากข้อมูลที่มีในฐานข้อมูลขณะสร้าง)`,
        '--  ผู้ใช้ตัวอย่าง student01–student12 รหัสผ่าน 1234',
        '-- =====================================================================',
        ...(d === 'mysql' ? ['USE mut_shuttle;', 'START TRANSACTION;'] : []),
      ];
      log[d].forEach((stmt, i) => {
        lines.push(`${stmt};`);
        if (monthMarks.includes(i + 1)) lines.push('COMMIT;', ...(d === 'mysql' && i + 1 < log[d].length ? ['START TRANSACTION;'] : []));
      });
      if (!monthMarks.includes(log[d].length)) lines.push('COMMIT;');
      fs.writeFileSync(file, `${lines.join('\n')}\n`);
      console.log(`  → ${path.relative(process.cwd(), file)}`);
    }
  }
}

module.exports = main;

if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = { sql: args.includes('--sql'), resetFirst: args.includes('--reset') };
  const years = args.filter((a) => /^\d+$/.test(a));
  const list = years.length ? years : [Number(today().slice(0, 4)) - 1, Number(today().slice(0, 4))];
  (async () => { for (const y of list) await main(y, opts); })()
    .catch((err) => { console.error(`\n${err.sqlMessage || err.message}`); process.exitCode = 1; })
    .finally(() => db.end());
}
