// 10.10 เส้นทาง + เส้นทาง_จุดจอด (ลำดับจุดจอดและเวลาเดินทางจากจุดก่อนหน้า)
const express = require('express');
const db = require('../../db');
const { requireScreen, requirePerm, SCREEN } = require('../../middleware/auth');

const router = express.Router();
router.use(requireScreen(SCREEN.ROUTES));

const allStops = () => db.query('SELECT stop_id, stop_name FROM stops ORDER BY stop_id');
const toArray = (v) => (v === undefined ? [] : [].concat(v));

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = await db.query(
    `SELECT rt.*, (SELECT COUNT(*) FROM trips t WHERE t.route_id = rt.route_id) AS trip_count
       FROM v_route_totals rt
      ${q ? 'WHERE rt.route_id LIKE ? OR rt.route_name LIKE ?' : ''}
      ORDER BY rt.route_id`,
    q ? [`%${q}%`, `%${q}%`] : [],
  );
  res.page('admin/routes', { title: 'เส้นทาง', rows, q });
});

async function renderForm(res, { values, rows, errors = {}, isNew, id }) {
  res.status(Object.keys(errors).length ? 422 : 200).page('admin/route-form', {
    title: isNew ? 'เพิ่มเส้นทาง' : `แก้ไขเส้นทาง ${id}`, values, rows, errors, isNew, id, stops: await allStops(),
  });
}

router.get('/new', requirePerm(SCREEN.ROUTES, 'add'), (req, res) => renderForm(res, {
  values: {}, rows: [{ stop_id: '', travel_minutes: 0 }, { stop_id: '', travel_minutes: '' }], isNew: true,
}));

// ตรวจข้อมูลฟอร์ม
async function validate(req, routeId) {
  const name = String(req.body.route_name || '').trim();
  const ids = toArray(req.body.stop_id);
  const mins = toArray(req.body.minutes);
  const rows = ids.map((stopId, i) => ({ stop_id: stopId, travel_minutes: i === 0 ? 0 : mins[i] }));
  const errors = {};
  if (!name) errors.route_name = 'กรุณากรอกชื่อเส้นทาง';
  else if (name.length > 100) errors.route_name = 'ชื่อเส้นทางยาวได้ไม่เกิน 100 ตัวอักษร';

  const valid = new Set((await allStops()).map((s) => s.stop_id));
  if (rows.length < 2) errors.stops = 'เส้นทางต้องมีอย่างน้อย 2 จุดจอด';
  rows.forEach((r, i) => {
    const n = Number(r.travel_minutes);
    if (!valid.has(r.stop_id)) errors.stops = `ลำดับ ${i + 1}: กรุณาเลือกจุดจอด`;
    else if (i > 0 && r.stop_id === rows[i - 1].stop_id) errors.stops = `ลำดับ ${i + 1}: จุดจอดติดกันต้องไม่ซ้ำกัน`;
    else if (i > 0 && !(Number.isInteger(n) && n > 0)) errors.stops = `ลำดับ ${i + 1}: เวลาเดินทางต้องเป็นจำนวนเต็มมากกว่า 0 นาที`;
    r.travel_minutes = i === 0 ? 0 : n;
  });

  // รายการจองที่ยังใช้งานของเส้นทางนี้ต้องยังมีจุดขึ้นก่อนจุดลงในลำดับใหม่
  if (routeId && !errors.stops) {
    const seq = rows.map((r) => r.stop_id);
    const used = await db.query(
      `SELECT DISTINCT bi.board_stop_id, bi.alight_stop_id
         FROM booking_items bi JOIN trips t ON t.trip_id = bi.trip_id
        WHERE t.route_id = ? AND t.status IN ('เปิด', 'กำลังเดินทาง') AND bi.status = 'ยืนยัน'`,
      [routeId],
    );
    const broken = used.filter((u) => {
      const b = seq.indexOf(u.board_stop_id);
      return b < 0 || seq.indexOf(u.alight_stop_id, b + 1) < 0;
    });
    if (broken.length) {
      errors.stops = `ไม่สามารถบันทึกได้ — มีรายการจองของรอบที่ยังเปิดอยู่ใช้ช่วงจุดจอดที่ถูกตัดออก (${broken.length} ช่วง)`;
    }
  }
  return { values: { route_name: name }, rows, errors };
}

async function saveStops(conn, routeId, rows) {
  await db.query('DELETE FROM route_stops WHERE route_id = ?', [routeId], conn);
  await db.query(
    'INSERT INTO route_stops (route_id, stop_order, stop_id, travel_minutes) VALUES ?',
    [rows.map((r, i) => [routeId, i + 1, r.stop_id, r.travel_minutes])],
    conn,
  );
}

router.post('/', requirePerm(SCREEN.ROUTES, 'add'), async (req, res) => {
  const { values, rows, errors } = await validate(req, null);
  if (Object.keys(errors).length) return renderForm(res, { values, rows, errors, isNew: true });
  const id = await db.tx(async (conn) => {
    const newId = await db.nextId('routes', 'route_id', 'R', 3, conn);
    await db.query('INSERT INTO routes (route_id, route_name) VALUES (?, ?)', [newId, values.route_name], conn);
    await saveStops(conn, newId, rows);
    return newId;
  });
  req.flash('success', `เพิ่มเส้นทาง ${id} เรียบร้อยแล้ว`);
  res.redirect(`/admin/routes/${id}`);
});

router.get('/:id', async (req, res, next) => {
  const route = await db.one('SELECT * FROM v_route_totals WHERE route_id = ?', [req.params.id]);
  if (!route) return next();
  const stops = await db.query('SELECT * FROM v_route_stop_times WHERE route_id = ? ORDER BY stop_order', [route.route_id]);
  const trips = await db.one(
    `SELECT COUNT(*) AS total, SUM(status = 'เปิด') AS open FROM trips WHERE route_id = ?`, [route.route_id],
  );
  res.page('admin/route-detail', { title: `เส้นทาง ${route.route_name}`, route, stops, trips });
});

router.get('/:id/edit', requirePerm(SCREEN.ROUTES, 'edit'), async (req, res, next) => {
  const route = await db.one('SELECT * FROM routes WHERE route_id = ?', [req.params.id]);
  if (!route) return next();
  const rows = await db.query(
    'SELECT stop_id, travel_minutes FROM route_stops WHERE route_id = ? ORDER BY stop_order', [route.route_id],
  );
  renderForm(res, { values: route, rows, isNew: false, id: route.route_id });
});

router.post('/:id', requirePerm(SCREEN.ROUTES, 'edit'), async (req, res, next) => {
  const id = req.params.id;
  if (!(await db.one('SELECT 1 AS ok FROM routes WHERE route_id = ?', [id]))) return next();
  const { values, rows, errors } = await validate(req, id);
  if (Object.keys(errors).length) return renderForm(res, { values, rows, errors, isNew: false, id });
  await db.tx(async (conn) => {
    await db.query('UPDATE routes SET route_name = ? WHERE route_id = ?', [values.route_name, id], conn);
    await saveStops(conn, id, rows);
  });
  req.flash('success', `บันทึกเส้นทาง ${id} เรียบร้อยแล้ว`);
  res.redirect(`/admin/routes/${id}`);
});

router.post('/:id/delete', requirePerm(SCREEN.ROUTES, 'delete'), async (req, res) => {
  const id = req.params.id;
  const { n } = await db.one('SELECT COUNT(*) AS n FROM trips WHERE route_id = ?', [id]);
  if (n) {
    req.flash('error', `ลบไม่ได้ เนื่องจากเส้นทางนี้ถูกใช้ใน ${n} รอบการเดินรถ`);
  } else {
    await db.query('DELETE FROM routes WHERE route_id = ?', [id]); // route_stops ลบตาม (CASCADE)
    req.flash('success', `ลบเส้นทาง ${id} เรียบร้อยแล้ว`);
  }
  res.redirect('/admin/routes');
});

module.exports = router;
