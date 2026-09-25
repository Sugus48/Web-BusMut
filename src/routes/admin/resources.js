// การตั้งค่าหน้าจัดการข้อมูลหลักที่ใช้ crud.js
const db = require('../../db');
const { SCREEN } = require('../../middleware/auth');

const count = async (sql, id) => (await db.one(sql, [id])).n;

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
};
