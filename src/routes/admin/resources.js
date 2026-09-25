// การตั้งค่าหน้าจัดการข้อมูลหลักที่ใช้ crud.js
const db = require('../../db');
const { SCREEN } = require('../../middleware/auth');

const count = async (sql, id) => (await db.one(sql, [id])).n;

// จำนวนที่นั่งของรอบ (Derived จากประเภทรถ) — อัปเดตรอบที่ยังเปิดเมื่อประเภทรถ/รถเปลี่ยน
const syncTripSeats = () => db.query(
  `UPDATE trips t
     JOIN vehicles v       ON v.vehicle_id = t.vehicle_id
     JOIN vehicle_types vt ON vt.vehicle_type_id = v.vehicle_type_id
      SET t.seat_count = vt.seat_count
    WHERE t.status = 'เปิด' AND t.seat_count <> vt.seat_count`,
);

const VEHICLE_STATUS = ['พร้อมใช้งาน', 'ซ่อมบำรุง', 'ไม่พร้อมใช้งาน'].map((s) => ({ value: s, label: s }));
const vehicleTypeOptions = async () => (await db.query('SELECT vehicle_type_id, type_name, seat_count FROM vehicle_types ORDER BY vehicle_type_id'))
  .map((t) => ({ value: t.vehicle_type_id, label: `${t.type_name} (${t.seat_count} ที่นั่ง)` }));

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
                (SELECT COUNT(*) FROM booking_items WHERE board_stop_id = ? OR alight_stop_id = ?) AS items`,
        [id, id, id],
      );
      const why = [];
      if (u.routes) why.push(`ถูกใช้ใน ${u.routes} เส้นทาง`);
      if (u.items) why.push(`ถูกใช้ใน ${u.items} รายการจอง`);
      return why.length ? `ลบจุดจอดไม่ได้ เนื่องจาก${why.join(' และ ')}` : null;
    },
  },
};
