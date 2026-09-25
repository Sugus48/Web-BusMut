// 10.6 สิทธิ์ตามตำแหน่ง (Permission Matrix)
// เข้าถึง = มี/ไม่มีแถวใน permissions, เพิ่ม/แก้ไข/ลบ = ค่า 0/1
const express = require('express');
const db = require('../../db');
const { requireScreen, requirePerm, SCREEN } = require('../../middleware/auth');

const router = express.Router();
router.use(requireScreen(SCREEN.PERMISSIONS));

router.get('/', async (req, res) => {
  const positions = await db.query('SELECT position_id, position_name FROM positions ORDER BY position_id');
  const position = positions.find((p) => p.position_id === req.query.position) || positions[0] || null;
  const screens = await db.query('SELECT screen_id, screen_name FROM screens ORDER BY screen_id');
  const rows = position
    ? await db.query('SELECT * FROM permissions WHERE position_id = ?', [position.position_id])
    : [];
  const perm = Object.fromEntries(rows.map((r) => [r.screen_id, r]));
  res.page('admin/permissions', { title: 'สิทธิ์ตามตำแหน่ง', positions, position, screens, perm });
});

router.post('/', requirePerm(SCREEN.PERMISSIONS, 'edit'), async (req, res) => {
  const positionId = req.body.position;
  const position = await db.one('SELECT position_id, position_name FROM positions WHERE position_id = ?', [positionId]);
  if (!position) {
    req.flash('error', 'ไม่พบตำแหน่ง');
    return res.redirect('/admin/permissions');
  }
  const screens = await db.query('SELECT screen_id FROM screens');
  const on = (k) => req.body[k] === '1';

  // กันผู้ใช้ถอดสิทธิ์จัดการสิทธิ์ของตำแหน่งตัวเอง (จะเข้าหน้านี้ไม่ได้อีก)
  if (positionId === res.locals.user.position_id
      && !(on(`access_${SCREEN.PERMISSIONS}`) && on(`edit_${SCREEN.PERMISSIONS}`))) {
    req.flash('error', 'ไม่สามารถถอดสิทธิ์ เข้าถึง/แก้ไข หน้าจอจัดการสิทธิ์ ของตำแหน่งตัวเองได้');
    return res.redirect(`/admin/permissions?position=${positionId}`);
  }

  await db.tx(async (conn) => {
    const existing = Object.fromEntries(
      (await db.query('SELECT screen_id, permission_id FROM permissions WHERE position_id = ? FOR UPDATE', [positionId], conn))
        .map((r) => [r.screen_id, r.permission_id]),
    );
    let n = Number((await db.nextId('permissions', 'permission_id', 'PR', 3, conn)).slice(2));
    for (const { screen_id: s } of screens) {
      const flags = { can_add: on(`add_${s}`) ? 1 : 0, can_edit: on(`edit_${s}`) ? 1 : 0, can_delete: on(`delete_${s}`) ? 1 : 0 };
      if (on(`access_${s}`)) {
        if (existing[s]) {
          await db.query('UPDATE permissions SET ? WHERE permission_id = ?', [flags, existing[s]], conn);
        } else {
          const id = `PR${String(n++).padStart(3, '0')}`;
          await db.query('INSERT INTO permissions SET ?', [{ permission_id: id, position_id: positionId, screen_id: s, ...flags }], conn);
        }
      } else if (existing[s]) {
        await db.query('DELETE FROM permissions WHERE permission_id = ?', [existing[s]], conn);
      }
    }
  });
  req.flash('success', `บันทึกสิทธิ์ของตำแหน่ง ${position.position_name} เรียบร้อยแล้ว`);
  res.redirect(`/admin/permissions?position=${positionId}`);
});

module.exports = router;
