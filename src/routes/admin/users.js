// 10.2 ผู้ใช้งาน / พนักงาน (พนักงาน = subclass ของ ผู้ใช้งาน + เบอร์โทร + ตำแหน่ง)
const express = require('express');
const db = require('../../db');
const { requireScreen, requirePerm, SCREEN } = require('../../middleware/auth');
const { hashPassword } = require('../../lib/password');

const router = express.Router();
router.use(requireScreen(SCREEN.USERS));

const lookups = async () => ({
  departments: await db.query('SELECT department_id, department_name FROM departments ORDER BY department_id'),
  positions: await db.query('SELECT position_id, position_name FROM positions ORDER BY position_id'),
});

router.get('/', async (req, res) => {
  const { q = '', department = '', position = '', type = '' } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    where.push('(u.user_id LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)');
    params.push(...Array(4).fill(`%${q.trim()}%`));
  }
  if (department) { where.push('u.department_id = ?'); params.push(department); }
  if (position) { where.push('e.position_id = ?'); params.push(position); }
  if (type === 'employee') where.push('e.user_id IS NOT NULL');
  if (type === 'user') where.push('e.user_id IS NULL');
  const rows = await db.query(
    `SELECT u.user_id, u.name, u.email, u.username, d.department_name, e.phone, p.position_name,
            CASE WHEN e.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_employee
       FROM users u
       JOIN departments d ON d.department_id = u.department_id
       LEFT JOIN employees e ON e.user_id = u.user_id
       LEFT JOIN positions p ON p.position_id = e.position_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY u.user_id`,
    params,
  );
  res.page('admin/users', { title: 'ผู้ใช้งาน / พนักงาน', rows, q, department, position, type, ...(await lookups()) });
});

async function renderForm(res, { values, errors = {}, isNew, id }) {
  res.status(Object.keys(errors).length ? 422 : 200).page('admin/user-form', {
    title: isNew ? 'เพิ่มผู้ใช้งาน' : `แก้ไขผู้ใช้งาน ${id}`, values, errors, isNew, id, ...(await lookups()),
  });
}

function validate(body, isNew, lk) {
  const v = {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim(),
    username: String(body.username || '').trim(),
    password: String(body.password || ''),
    department_id: body.department_id || '',
    is_employee: body.is_employee === '1',
    phone: String(body.phone || '').trim(),
    position_id: body.position_id || '',
  };
  const e = {};
  if (!v.name) e.name = 'กรุณากรอกชื่อ';
  else if (v.name.length > 100) e.name = 'ชื่อยาวได้ไม่เกิน 100 ตัวอักษร';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) e.email = 'รูปแบบ email ไม่ถูกต้อง';
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(v.username)) e.username = 'username ใช้ a-z, 0-9, _ . - ความยาว 3–50 ตัวอักษร';
  if (isNew && v.password.length < 4) e.password = 'password ต้องมีอย่างน้อย 4 ตัวอักษร';
  if (!isNew && v.password && v.password.length < 4) e.password = 'password ต้องมีอย่างน้อย 4 ตัวอักษร';
  if (!lk.departments.some((d) => d.department_id === v.department_id)) e.department_id = 'กรุณาเลือกแผนก';
  if (v.is_employee) {
    if (!/^[0-9+\- ]{6,20}$/.test(v.phone)) e.phone = 'กรุณากรอกเบอร์โทร (ตัวเลข 6–20 หลัก)';
    if (!lk.positions.some((p) => p.position_id === v.position_id)) e.position_id = 'กรุณาเลือกตำแหน่ง';
  }
  return { v, e };
}

function duplicateError(err, e) {
  if (err.errno !== 1062) return false;
  if (/email/i.test(err.sqlMessage)) e.email = 'email นี้ถูกใช้แล้ว';
  else e.username = 'username นี้ถูกใช้แล้ว';
  return true;
}

async function saveEmployee(conn, id, v) {
  if (v.is_employee) {
    const data = { phone: v.phone, position_id: v.position_id };
    const exists = await db.one('SELECT 1 AS ok FROM employees WHERE user_id = ?', [id], conn);
    if (exists) await db.update('employees', data, { user_id: id }, conn);
    else await db.insert('employees', { user_id: id, ...data }, conn);
  } else {
    await db.query('DELETE FROM employees WHERE user_id = ?', [id], conn);
  }
}

router.get('/new', requirePerm(SCREEN.USERS, 'add'), (req, res) => renderForm(res, { values: {}, isNew: true }));

router.post('/', requirePerm(SCREEN.USERS, 'add'), async (req, res) => {
  const { v, e } = validate(req.body, true, await lookups());
  if (!Object.keys(e).length) {
    try {
      const id = await db.tx(async (conn) => {
        const newId = await db.nextId('users', 'user_id', 'U', 3, conn);
        await db.insert('users', {
          user_id: newId, name: v.name, email: v.email, username: v.username,
          password_hash: await hashPassword(v.password), department_id: v.department_id,
        }, conn);
        await saveEmployee(conn, newId, v);
        return newId;
      });
      req.flash('success', `เพิ่มผู้ใช้งาน ${id} (${v.name}) เรียบร้อยแล้ว`);
      return res.redirect('/admin/users');
    } catch (err) {
      if (!duplicateError(err, e)) throw err;
    }
  }
  renderForm(res, { values: v, errors: e, isNew: true });
});

router.get('/:id/edit', requirePerm(SCREEN.USERS, 'edit'), async (req, res, next) => {
  const row = await db.one(
    `SELECT u.*, e.phone, e.position_id, CASE WHEN e.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_employee
       FROM users u LEFT JOIN employees e ON e.user_id = u.user_id WHERE u.user_id = ?`,
    [req.params.id],
  );
  if (!row) return next();
  renderForm(res, { values: { ...row, is_employee: !!row.is_employee }, isNew: false, id: row.user_id });
});

router.post('/:id', requirePerm(SCREEN.USERS, 'edit'), async (req, res, next) => {
  const id = req.params.id;
  if (!(await db.one('SELECT 1 AS ok FROM users WHERE user_id = ?', [id]))) return next();
  const { v, e } = validate(req.body, false, await lookups());
  if (id === res.locals.user.user_id && !v.is_employee) e.is_employee = 'ไม่สามารถยกเลิกสถานะพนักงานของตัวเองได้';
  if (!Object.keys(e).length) {
    try {
      await db.tx(async (conn) => {
        const data = { name: v.name, email: v.email, username: v.username, department_id: v.department_id };
        if (v.password) data.password_hash = await hashPassword(v.password);
        await db.update('users', data, { user_id: id }, conn);
        await saveEmployee(conn, id, v);
      });
      req.flash('success', `บันทึกผู้ใช้งาน ${id} เรียบร้อยแล้ว`);
      return res.redirect('/admin/users');
    } catch (err) {
      if (err.errno === 1451) e.is_employee = 'ยกเลิกสถานะพนักงานไม่ได้ เนื่องจากเป็นคนขับในรอบการเดินรถ';
      else if (!duplicateError(err, e)) throw err;
    }
  }
  renderForm(res, { values: v, errors: e, isNew: false, id });
});

router.post('/:id/delete', requirePerm(SCREEN.USERS, 'delete'), async (req, res) => {
  const id = req.params.id;
  const usage = await db.one(
    `SELECT (SELECT COUNT(*) FROM bookings WHERE user_id = ?) AS bookings,
            (SELECT COUNT(*) FROM trips WHERE driver_id = ?) AS trips
       FROM DUAL`,
    [id, id],
  );
  if (id === res.locals.user.user_id) req.flash('error', 'ไม่สามารถลบบัญชีของตัวเองได้');
  else if (usage.bookings) req.flash('error', `ลบไม่ได้ เนื่องจากผู้ใช้งานนี้มีประวัติการจอง ${usage.bookings} รายการ`);
  else if (usage.trips) req.flash('error', `ลบไม่ได้ เนื่องจากผู้ใช้งานนี้เป็นคนขับใน ${usage.trips} รอบ`);
  else {
    await db.query('DELETE FROM users WHERE user_id = ?', [id]);
    req.flash('success', `ลบผู้ใช้งาน ${id} เรียบร้อยแล้ว`);
  }
  res.redirect('/admin/users');
});

module.exports = router;
