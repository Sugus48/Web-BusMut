// การตั้งค่าหน้าจัดการข้อมูลหลักที่ใช้ crud.js
const db = require('../../db');
const { SCREEN } = require('../../middleware/auth');
const { fmtTime, addMinutes } = require('../../lib/helpers');
const { refreshSchedule, dropSchedule } = require('../../lib/schedule');

const count = async (sql, id) => (await db.one(sql, [id])).n;

// จำนวนที่นั่งของรอบ (Derived จากประเภทรถ) — อัปเดตรอบที่ยังเปิดเมื่อประเภทรถ/รถเปลี่ยน
const SEATS_OF_TRIP = `(SELECT vt.seat_count FROM vehicles v
                          JOIN vehicle_types vt ON vt.vehicle_type_id = v.vehicle_type_id
                         WHERE v.vehicle_id = trips.vehicle_id)`;
const syncTripSeats = () => db.query(
  `UPDATE trips SET seat_count = ${SEATS_OF_TRIP}
    WHERE status = 'เปิด' AND seat_count <> ${SEATS_OF_TRIP}`,
);

const VEHICLE_STATUS = ['พร้อมใช้งาน', 'ซ่อมบำรุง', 'ไม่พร้อมใช้งาน'].map((s) => ({ value: s, label: s }));
const vehicleTypeOptions = async () => (await db.query('SELECT vehicle_type_id, type_name, seat_count FROM vehicle_types ORDER BY vehicle_type_id'))
  .map((t) => ({ value: t.vehicle_type_id, label: `${t.type_name} (${t.seat_count} ที่นั่ง)` }));

const routeOptions = async () => (await db.query('SELECT route_id, route_name, total_minutes FROM v_route_totals ORDER BY route_id'))
  .map((r) => ({ value: r.route_id, label: `${r.route_name} (${r.total_minutes} นาที)` }));
const vehicleOptions = async () => (await db.query(
  `SELECT v.vehicle_id, v.plate_no, v.status, vt.type_name, vt.seat_count
     FROM vehicles v JOIN vehicle_types vt ON vt.vehicle_type_id = v.vehicle_type_id ORDER BY v.plate_no`,
)).map((v) => ({
  value: v.vehicle_id,
  label: `${v.plate_no} ${v.type_name} ${v.seat_count} ที่นั่ง${v.status === 'พร้อมใช้งาน' ? '' : ` (${v.status})`}`,
}));
// คนขับ = พนักงานที่ตำแหน่งมีสิทธิ์หน้าจองานคนขับ (เหมือนหน้าจัดรอบ)
const driverOptions = async () => (await db.query(
  `SELECT u.user_id, u.name FROM employees e JOIN users u ON u.user_id = e.user_id
    WHERE e.position_id IN (SELECT position_id FROM permissions WHERE screen_id = ?) ORDER BY u.name`,
  [SCREEN.DRIVER],
)).map((u) => ({ value: u.user_id, label: u.name }));
const ACTIVE = [{ value: '1', label: 'ใช้งาน' }, { value: '0', label: 'หยุดใช้งาน' }];

const toMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

// ตารางเวลาที่ใช้งานอยู่ซึ่งใช้รถ/คนขับเดียวกันในช่วงเวลาทับกัน
async function scheduleConflicts(v, id) {
  if (String(v.active) !== '1') return {};
  const rows = await db.query(
    `SELECT s.schedule_id, s.depart_time, s.vehicle_id, s.driver_id, r.route_name, rt.total_minutes
       FROM trip_schedules s
       JOIN routes r ON r.route_id = s.route_id
       JOIN v_route_totals rt ON rt.route_id = s.route_id
      WHERE s.active = 1 AND s.schedule_id <> ?`,
    [id || '-'], // Oracle ถือ '' = NULL จึงใช้ '-' แทน
  );
  const route = await db.one('SELECT total_minutes FROM v_route_totals WHERE route_id = ?', [v.route_id]);
  const start = toMinutes(v.depart_time);
  const end = start + Math.max(1, route ? route.total_minutes : 0);
  const errors = {};
  for (const r of rows) {
    const s = toMinutes(r.depart_time);
    if (!(s < end && start < s + Math.max(1, r.total_minutes))) continue;
    const range = `${r.schedule_id} ${r.route_name} ${fmtTime(r.depart_time)}–${addMinutes(r.depart_time, r.total_minutes)}`;
    if (r.vehicle_id === v.vehicle_id && !errors.vehicle_id) errors.vehicle_id = `รถคันนี้ถูกใช้ในตารางเวลา ${range}`;
    if (r.driver_id === v.driver_id && !errors.driver_id) errors.driver_id = `คนขับคนนี้มีงานในตารางเวลา ${range}`;
  }
  return errors;
}

module.exports = {
  // 10.3 แผนก
  '/departments': {
    screen: SCREEN.DEPARTMENTS,
    title: 'แผนก',
    table: 'departments', pk: 'department_id', prefix: 'D', pad: 3,
    listSql: `SELECT d.department_id, d.department_name,
                     (SELECT COUNT(*) FROM users u WHERE u.department_id = d.department_id) AS user_count
                FROM departments d`,
    searchCols: ['department_id', 'department_name'],
    columns: [
      { key: 'department_id', label: 'รหัสแผนก' },
      { key: 'department_name', label: 'ชื่อแผนก' },
      { key: 'user_count', label: 'จำนวนผู้ใช้งาน', align: 'right' },
    ],
    fields: [{ name: 'department_name', label: 'ชื่อแผนก', type: 'text', required: true, max: 100 }],
    nameOf: (r) => r.department_name,
    beforeDelete: async (id) => {
      const n = await count('SELECT COUNT(*) AS n FROM users WHERE department_id = ?', id);
      return n ? `ลบไม่ได้ เนื่องจากมีผู้ใช้งาน ${n} คนอยู่ในแผนกนี้` : null;
    },
  },

  // 10.4 ตำแหน่ง
  '/positions': {
    screen: SCREEN.POSITIONS,
    title: 'ตำแหน่ง',
    table: 'positions', pk: 'position_id', prefix: 'P', pad: 2,
    listSql: `SELECT p.position_id, p.position_name,
                     (SELECT COUNT(*) FROM employees e WHERE e.position_id = p.position_id) AS employee_count,
                     (SELECT COUNT(*) FROM permissions x WHERE x.position_id = p.position_id) AS screen_count
                FROM positions p`,
    searchCols: ['position_id', 'position_name'],
    columns: [
      { key: 'position_id', label: 'รหัสตำแหน่ง' },
      { key: 'position_name', label: 'ชื่อตำแหน่ง' },
      { key: 'employee_count', label: 'จำนวนพนักงาน', align: 'right' },
      { key: 'screen_count', label: 'หน้าจอที่เข้าถึงได้', align: 'right' },
    ],
    fields: [{ name: 'position_name', label: 'ชื่อตำแหน่ง', type: 'text', required: true, max: 100 }],
    rowLinks: [{ label: 'กำหนดสิทธิ์', href: (r) => `/admin/permissions?position=${r.position_id}`, screen: SCREEN.PERMISSIONS }],
    nameOf: (r) => r.position_name,
    deleteWarning: 'สิทธิ์ทั้งหมดของตำแหน่งนี้จะถูกลบด้วย',
    beforeDelete: async (id) => {
      const n = await count('SELECT COUNT(*) AS n FROM employees WHERE position_id = ?', id);
      return n ? `ลบไม่ได้ เนื่องจากมีพนักงาน ${n} คนอยู่ในตำแหน่งนี้` : null;
    },
  },

  // 10.5 หน้าจอ
  '/screens': {
    screen: SCREEN.PERMISSIONS,
    title: 'หน้าจอ',
    note: `หน้าจอ ${Object.values(SCREEN)[0]}–${Object.values(SCREEN).slice(-1)[0]} ผูกกับเมนูของระบบ (แก้ชื่อได้ แต่ลบไม่ได้)`,
    table: 'screens', pk: 'screen_id', prefix: 'SC', pad: 2,
    listSql: `SELECT s.screen_id, s.screen_name,
                     (SELECT COUNT(*) FROM permissions p WHERE p.screen_id = s.screen_id) AS position_count
                FROM screens s`,
    searchCols: ['screen_id', 'screen_name'],
    columns: [
      { key: 'screen_id', label: 'รหัสหน้าจอ' },
      { key: 'screen_name', label: 'ชื่อหน้าจอ' },
      { key: 'position_count', label: 'จำนวนตำแหน่งที่เข้าถึงได้', align: 'right' },
    ],
    fields: [{ name: 'screen_name', label: 'ชื่อหน้าจอ', type: 'text', required: true, max: 100 }],
    nameOf: (r) => r.screen_name,
    deleteWarning: 'สิทธิ์ของหน้าจอนี้ในทุกตำแหน่งจะถูกลบด้วย',
    beforeDelete: async (id) => (Object.values(SCREEN).includes(id) ? 'หน้าจอนี้ถูกใช้งานโดยระบบ ลบไม่ได้' : null),
  },

  // 10.7 ประเภทรถ
  '/vehicle-types': {
    screen: SCREEN.VEHICLE_TYPES,
    title: 'ประเภทรถ',
    table: 'vehicle_types', pk: 'vehicle_type_id', prefix: 'T', pad: 2,
    listSql: `SELECT vt.vehicle_type_id, vt.type_name, vt.description, vt.seat_count,
                     (SELECT COUNT(*) FROM vehicles v WHERE v.vehicle_type_id = vt.vehicle_type_id) AS vehicle_count
                FROM vehicle_types vt`,
    searchCols: ['vehicle_type_id', 'type_name', 'description'],
    columns: [
      { key: 'vehicle_type_id', label: 'รหัสประเภทรถ' },
      { key: 'type_name', label: 'ชื่อประเภทรถ' },
      { key: 'description', label: 'รายละเอียด' },
      { key: 'seat_count', label: 'จำนวนที่นั่ง', align: 'right' },
      { key: 'vehicle_count', label: 'จำนวนรถ', align: 'right' },
    ],
    fields: [
      { name: 'type_name', label: 'ชื่อประเภทรถ', type: 'text', required: true, max: 50 },
      { name: 'description', label: 'รายละเอียด', type: 'textarea', max: 255 },
      { name: 'seat_count', label: 'จำนวนที่นั่ง', type: 'number', required: true, min: 1,
        hint: 'เมื่อแก้ไข รอบที่ยังเปิดจองของรถประเภทนี้จะใช้จำนวนที่นั่งใหม่' },
    ],
    nameOf: (r) => r.type_name,
    afterSave: syncTripSeats,
    beforeDelete: async (id) => {
      const n = await count('SELECT COUNT(*) AS n FROM vehicles WHERE vehicle_type_id = ?', id);
      return n ? `ลบไม่ได้ เนื่องจากมีรถ ${n} คันเป็นประเภทนี้` : null;
    },
  },

  // 10.8 รถ
  '/vehicles': {
    screen: SCREEN.VEHICLES,
    title: 'รถ',
    table: 'vehicles', pk: 'vehicle_id', prefix: 'V', pad: 3,
    listSql: `SELECT v.vehicle_id, v.plate_no, v.vehicle_type_id, vt.type_name, vt.seat_count, v.status
                FROM vehicles v JOIN vehicle_types vt ON vt.vehicle_type_id = v.vehicle_type_id`,
    searchCols: ['vehicle_id', 'plate_no'],
    filters: [
      { name: 'vehicle_type_id', label: 'ประเภทรถ', options: vehicleTypeOptions },
      { name: 'status', label: 'สถานะ', options: VEHICLE_STATUS },
    ],
    columns: [
      { key: 'vehicle_id', label: 'รหัสรถ' },
      { key: 'plate_no', label: 'ทะเบียนรถ' },
      { key: 'type_name', label: 'ประเภทรถ' },
      { key: 'seat_count', label: 'จำนวนที่นั่ง', align: 'right' },
      { key: 'status', label: 'สถานะ', badge: true },
    ],
    fields: [
      { name: 'plate_no', label: 'ทะเบียนรถ', type: 'text', required: true, max: 20 },
      { name: 'vehicle_type_id', label: 'ประเภทรถ', type: 'select', required: true, options: vehicleTypeOptions,
        hint: 'จำนวนที่นั่งของรถมาจากประเภทรถ' },
      { name: 'status', label: 'สถานะ', type: 'select', required: true, options: VEHICLE_STATUS,
        hint: 'เฉพาะรถ "พร้อมใช้งาน" ที่เลือกได้ตอนจัดรอบการเดินรถ' },
    ],
    unique: { plate_no: 'ทะเบียนรถนี้มีอยู่ในระบบแล้ว' },
    nameOf: (r) => `ทะเบียน ${r.plate_no}`,
    afterSave: syncTripSeats,
    beforeDelete: async (id) => {
      const n = await count('SELECT COUNT(*) AS n FROM trips WHERE vehicle_id = ?', id);
      return n ? `ลบไม่ได้ เนื่องจากรถคันนี้ถูกใช้ใน ${n} รอบ — เปลี่ยนสถานะเป็น "ไม่พร้อมใช้งาน" แทน` : null;
    },
  },

  // ตารางเวลาเดินรถประจำ — ระบบสร้างรอบของแต่ละวันล่วงหน้าจากตารางนี้
  '/schedules': {
    screen: SCREEN.TRIPS,
    title: 'ตารางเวลาเดินรถ',
    note: 'ระบบสร้างรอบการเดินรถของทุกวันล่วงหน้า 7 วันจากตารางนี้ — แก้ไขแล้วรอบที่ยังไม่มีคนจองจะเปลี่ยนตาม ส่วนรอบที่มีการจองแล้วแก้ได้ที่หน้ารอบการเดินรถ',
    table: 'trip_schedules', pk: 'schedule_id', prefix: 'TS', pad: 3,
    listSql: `SELECT s.schedule_id, s.route_id, r.route_name, s.depart_time, s.vehicle_id, s.driver_id, s.active,
                     ROW_NUMBER() OVER (PARTITION BY s.route_id ORDER BY s.depart_time) AS round_no,
                     v.plate_no, vt.type_name, vt.seat_count, u.name AS driver_name,
                     CASE WHEN s.active = 1 THEN 'ใช้งาน' ELSE 'หยุดใช้งาน' END AS active_label
                FROM trip_schedules s
                JOIN routes r         ON r.route_id = s.route_id
                JOIN vehicles v       ON v.vehicle_id = s.vehicle_id
                JOIN vehicle_types vt ON vt.vehicle_type_id = v.vehicle_type_id
                JOIN users u          ON u.user_id = s.driver_id`,
    orderBy: 'x.route_id, x.depart_time',
    filters: [
      { name: 'route_id', label: 'เส้นทาง', options: routeOptions },
      { name: 'driver_id', label: 'คนขับ', options: driverOptions },
    ],
    columns: [
      { key: 'schedule_id', label: 'รหัส' },
      { key: 'route_name', label: 'เส้นทาง' },
      { key: 'round_no', label: 'รอบที่', align: 'right' },
      { key: 'depart_time', label: 'เวลา', fmt: (r) => fmtTime(r.depart_time) },
      { key: 'driver_name', label: 'คนขับ' },
      { key: 'plate_no', label: 'รถ', fmt: (r) => `${r.plate_no} ${r.type_name} ${r.seat_count} ที่นั่ง` },
      { key: 'active_label', label: 'สถานะ', badge: true },
    ],
    fields: [
      { name: 'route_id', label: 'เส้นทาง', type: 'select', required: true, options: routeOptions },
      { name: 'depart_time', label: 'เวลาออก', type: 'time', required: true },
      { name: 'driver_id', label: 'คนขับ', type: 'select', required: true, options: driverOptions },
      { name: 'vehicle_id', label: 'รถ', type: 'select', required: true, options: vehicleOptions,
        hint: 'รถที่ไม่อยู่ในสถานะพร้อมใช้งาน ระบบจะข้ามไม่สร้างรอบให้' },
      { name: 'active', label: 'สถานะ', type: 'select', required: true, options: ACTIVE,
        hint: 'หยุดใช้งาน = ไม่สร้างรอบใหม่ และลบรอบล่วงหน้าที่ยังไม่มีคนจอง' },
    ],
    check: scheduleConflicts,
    unique: { depart_time: 'เส้นทางนี้มีรอบเวลานี้อยู่แล้ว' },
    nameOf: (r) => `${r.route_name} ${fmtTime(r.depart_time)}`,
    afterSave: refreshSchedule,
    deleteWarning: 'รอบล่วงหน้าที่ยังไม่มีคนจองจะถูกลบด้วย',
    beforeDelete: async (id) => { await dropSchedule(id); return null; },
  },

  // 10.9 จุดจอด
  '/stops': {
    screen: SCREEN.STOPS,
    title: 'จุดจอด',
    note: 'ห้ามลบจุดจอดที่ถูกใช้ในเส้นทางหรือรายการจอง',
    table: 'stops', pk: 'stop_id', prefix: 'S', pad: 3,
    listSql: `SELECT s.stop_id, s.stop_name,
                     (SELECT COUNT(DISTINCT rs.route_id) FROM route_stops rs WHERE rs.stop_id = s.stop_id) AS route_count,
                     (SELECT COUNT(*) FROM booking_items bi
                       WHERE bi.board_stop_id = s.stop_id OR bi.alight_stop_id = s.stop_id) AS item_count
                FROM stops s`,
    searchCols: ['stop_id', 'stop_name'],
    columns: [
      { key: 'stop_id', label: 'รหัสจุดจอด' },
      { key: 'stop_name', label: 'ชื่อจุดจอด' },
      { key: 'route_count', label: 'ใช้ในเส้นทาง', align: 'right' },
      { key: 'item_count', label: 'ใช้ในรายการจอง', align: 'right' },
    ],
    fields: [{ name: 'stop_name', label: 'ชื่อจุดจอด', type: 'text', required: true, max: 150 }],
    nameOf: (r) => r.stop_name,
    beforeDelete: async (id) => {
      const u = await db.one(
        `SELECT (SELECT COUNT(DISTINCT route_id) FROM route_stops WHERE stop_id = ?) AS routes,
                (SELECT COUNT(*) FROM booking_items WHERE board_stop_id = ? OR alight_stop_id = ?) AS items
           FROM DUAL`,
        [id, id, id],
      );
      const why = [];
      if (u.routes) why.push(`ถูกใช้ใน ${u.routes} เส้นทาง`);
      if (u.items) why.push(`ถูกใช้ใน ${u.items} รายการจอง`);
      return why.length ? `ลบจุดจอดไม่ได้ เนื่องจาก${why.join(' และ ')}` : null;
    },
  },
};
