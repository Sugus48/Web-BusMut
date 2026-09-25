// 10.12 การจอง (การจอง / รายการจอง)
const express = require('express');
const QRCode = require('qrcode');
const db = require('../../db');
const { requireScreen, requirePerm, SCREEN } = require('../../middleware/auth');
const { ITEM_SELECT } = require('../../lib/queries');

const router = express.Router();
router.use(requireScreen(SCREEN.BOOKINGS));

const ITEM_STATUS = ['ยืนยัน', 'ยกเลิก', 'No Show'];
const FILTER_STATUS = ['ยืนยัน', 'Check-in แล้ว', 'ยกเลิก', 'No Show'];

router.get('/', async (req, res) => {
  const f = { from: '', to: '', status: '', route: '', q: '', trip: '', ...req.query };
  const where = [];
  const params = [];
  if (f.from) { where.push('tr.trip_date >= ?'); params.push(f.from); }
  if (f.to) { where.push('tr.trip_date <= ?'); params.push(f.to); }
  if (f.route) { where.push('tr.route_id = ?'); params.push(f.route); }
  if (f.trip) { where.push('t.trip_id = ?'); params.push(f.trip); }
  if (f.status === 'Check-in แล้ว') where.push('t.checkin_at IS NOT NULL');
  else if (f.status === 'ยืนยัน') where.push("t.status = 'ยืนยัน' AND t.checkin_at IS NULL");
  else if (f.status) { where.push('t.status = ?'); params.push(f.status); }
  if (f.q.trim()) {
    where.push('(t.booking_id LIKE ? OR t.booking_item_id LIKE ? OR t.passenger_name LIKE ? OR bi.qr_code = ?)');
    params.push(`%${f.q.trim()}%`, `%${f.q.trim()}%`, `%${f.q.trim()}%`, f.q.trim());
  }
  const rows = await db.query(
    `${ITEM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY b.booked_at DESC, t.booking_item_id DESC LIMIT 500`,
    params,
  );
  const routes = await db.query('SELECT route_id, route_name FROM routes ORDER BY route_id');
  res.page('admin/bookings', { title: 'การจอง', rows, f, routes, statuses: FILTER_STATUS });
});

router.get('/:id', async (req, res, next) => {
  const booking = await db.one(
    `SELECT b.booking_id, b.booked_at, u.user_id, u.name, u.email, u.username, d.department_name
       FROM bookings b JOIN users u ON u.user_id = b.user_id JOIN departments d ON d.department_id = u.department_id
      WHERE b.booking_id = ?`,
    [req.params.id],
  );
  if (!booking) return next();
  const items = await db.query(`${ITEM_SELECT} WHERE t.booking_id = ? ORDER BY t.booking_item_id`, [booking.booking_id]);
  for (const i of items) i.qr = await QRCode.toDataURL(i.qr_code, { width: 240, margin: 1 });
  res.page('admin/booking-detail', { title: `การจอง ${booking.booking_id}`, booking, items, statuses: ITEM_STATUS });
});

// ยกเลิกรายการจอง (โดยเจ้าหน้าที่ — ไม่ตรวจเจ้าของ)
router.post('/items/:item/cancel', requirePerm(SCREEN.BOOKINGS, 'edit'), async (req, res) => {
  const item = await db.one('SELECT booking_id FROM booking_items WHERE booking_item_id = ?', [req.params.item]);
  try {
    await db.proc.cancelItem(req.params.item, null);
    req.flash('success', `ยกเลิกรายการจอง ${req.params.item} แล้ว — คืนที่นั่งให้รอบเรียบร้อย`);
  } catch (err) {
    if (!err.sqlState) throw err;
    req.flash('error', db.errorMessage(err));
  }
  res.redirect(item ? `/admin/bookings/${item.booking_id}` : '/admin/bookings');
});

// เปลี่ยนสถานะรายการจอง (trigger ตรวจที่นั่งเมื่อเปิดรายการที่ยกเลิกกลับมา)
router.post('/items/:item/status', requirePerm(SCREEN.BOOKINGS, 'edit'), async (req, res) => {
  const item = await db.one('SELECT booking_id FROM booking_items WHERE booking_item_id = ?', [req.params.item]);
  if (!item) return res.redirect('/admin/bookings');
  if (!ITEM_STATUS.includes(req.body.status)) {
    req.flash('error', 'สถานะไม่ถูกต้อง');
  } else {
    try {
      await db.query('UPDATE booking_items SET status = ? WHERE booking_item_id = ?', [req.body.status, req.params.item]);
      req.flash('success', `เปลี่ยนสถานะรายการ ${req.params.item} เป็น ${req.body.status} แล้ว`);
    } catch (err) {
      if (!err.sqlState) throw err;
      req.flash('error', db.errorMessage(err));
    }
  }
  res.redirect(`/admin/bookings/${item.booking_id}`);
});

router.post('/:id/delete', requirePerm(SCREEN.BOOKINGS, 'delete'), async (req, res) => {
  await db.query('DELETE FROM bookings WHERE booking_id = ?', [req.params.id]); // รายการจองลบตาม (CASCADE)
  req.flash('success', `ลบการจอง ${req.params.id} เรียบร้อยแล้ว`);
  res.redirect('/admin/bookings');
});

module.exports = router;
