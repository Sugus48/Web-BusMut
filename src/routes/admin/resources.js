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
};
