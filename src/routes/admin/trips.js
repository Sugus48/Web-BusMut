// 10.11 รอบการเดินรถ (List / Form / Conflict Validation)
const express = require('express');
const db = require('../../db');
const { requireScreen, requirePerm, SCREEN } = require('../../middleware/auth');
const { TRIP_SELECT } = require('../../lib/queries');
const { today, fmtTime, fmtDate } = require('../../lib/helpers');

const router = express.Router();
router.use(requireScreen(SCREEN.TRIPS));

const TRIP_STATUS = ['เปิด', 'กำลังเดินทาง', 'เสร็จสิ้น', 'ยกเลิก'];

// ตัวเลือกในฟอร์ม/ตัวกรอง — คนขับ = พนักงานที่ตำแหน่งมีสิทธิ์หน้าจองานคนขับ
async function lookups({ vehicleId, driverId } = {}) {
  return {
    routes: await db.query('SELECT route_id, route_name, total_minutes FROM v_route_totals ORDER BY route_id'),
    vehicles: await db.query(
      `SELECT v.vehicle_id, v.plate_no, v.status, vt.type_name, vt.seat_count
         FROM vehicles v JOIN vehicle_types vt ON vt.vehicle_type_id = v.vehicle_type_id
        WHERE v.status = 'พร้อมใช้งาน' OR v.vehicle_id = ?
        ORDER BY v.plate_no`,
      [vehicleId || ''],
    ),
    allVehicles: await db.query('SELECT vehicle_id, plate_no FROM vehicles ORDER BY plate_no'),
    drivers: await db.query(
      `SELECT u.user_id, u.name, p.position_name
         FROM employees e JOIN users u ON u.user_id = e.user_id JOIN positions p ON p.position_id = e.position_id
        WHERE e.position_id IN (SELECT position_id FROM permissions WHERE screen_id = ?) OR e.user_id = ?
        ORDER BY u.name`,
      [SCREEN.DRIVER, driverId || ''],
    ),
    statuses: TRIP_STATUS,
  };
}

router.get('/', async (req, res) => {
  const f = { date: '', route: '', driver: '', vehicle: '', status: '', ...req.query };
  if (!Object.keys(req.query).length) f.date = today(); // ค่าเริ่มต้น = รอบวันนี้
  const where = [];
  const params = [];
  if (f.date) { where.push('tr.trip_date = ?'); params.push(f.date); }
  if (f.route) { where.push('tr.route_id = ?'); params.push(f.route); }
  if (f.driver) { where.push('tr.driver_id = ?'); params.push(f.driver); }
  if (f.vehicle) { where.push('tr.vehicle_id = ?'); params.push(f.vehicle); }
  if (f.status) { where.push('tr.status = ?'); params.push(f.status); }
  const rows = await db.query(
    `${TRIP_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY tr.trip_date DESC, tr.depart_time LIMIT 500`,
    params,
  );
  res.page('admin/trips', { title: 'รอบการเดินรถ', rows, f, ...(await lookups()) });
});

async function renderForm(res, { values, errors = {}, isNew, id, trip }) {
  res.status(Object.keys(errors).length ? 422 : 200).page('admin/trip-form', {
    title: isNew ? 'เพิ่มรอบการเดินรถ' : `แก้ไขรอบ ${id}`, values, errors, isNew, id, trip: trip || null,
    ...(await lookups({ vehicleId: values.vehicle_id, driverId: values.driver_id })),
  });
}

// รอบอื่นที่ใช้รถ/คนขับเดียวกันและช่วงเวลาทับกัน
async function findConflicts(v, excludeId) {
  const route = await db.one('SELECT total_minutes FROM v_route_totals WHERE route_id = ?', [v.route_id]);
  const minutes = route ? route.total_minutes : 0;
  return db.query(
    `${TRIP_SELECT}
      WHERE tr.trip_date = ? AND tr.status <> 'ยกเลิก' AND tr.trip_id <> ?
        AND (tr.vehicle_id = ? OR tr.driver_id = ?)
        AND TIMESTAMP(tr.trip_date, tr.depart_time) < TIMESTAMP(?, ?) + INTERVAL ? MINUTE
        AND TIMESTAMP(?, ?) < TIMESTAMP(tr.trip_date, tr.depart_time) + INTERVAL rt.total_minutes MINUTE`,
    [v.trip_date, excludeId || '', v.vehicle_id, v.driver_id, v.trip_date, v.depart_time, minutes, v.trip_date, v.depart_time],
  );
}

async function validate(body, { isNew, trip }) {
  const v = {
    route_id: body.route_id || '',
    trip_date: body.trip_date || '',
    depart_time: String(body.depart_time || '').slice(0, 5),
    vehicle_id: body.vehicle_id || '',
    driver_id: body.driver_id || '',
    status: isNew ? 'เปิด' : body.status,
  };
  const e = {};
  const lk = await lookups({ vehicleId: trip && trip.vehicle_id, driverId: trip && trip.driver_id });
  if (!lk.routes.some((r) => r.route_id === v.route_id)) e.route_id = 'กรุณาเลือกเส้นทาง';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.trip_date)) e.trip_date = 'กรุณาเลือกวันที่เดินรถ';
  else if (isNew && v.trip_date < today()) e.trip_date = 'ไม่สามารถจัดรอบย้อนหลังได้';
  if (!/^\d{2}:\d{2}$/.test(v.depart_time)) e.depart_time = 'กรุณาระบุเวลาออก';
  const vehicle = lk.vehicles.find((x) => x.vehicle_id === v.vehicle_id);
  if (!vehicle) e.vehicle_id = 'กรุณาเลือกรถที่พร้อมใช้งาน';
  else if (vehicle.status !== 'พร้อมใช้งาน' && (isNew || v.vehicle_id !== trip.vehicle_id)) e.vehicle_id = 'รถคันนี้ไม่อยู่ในสถานะพร้อมใช้งาน';
  if (!lk.drivers.some((d) => d.user_id === v.driver_id)) e.driver_id = 'กรุณาเลือกคนขับ';
  if (!TRIP_STATUS.includes(v.status)) e.status = 'กรุณาเลือกสถานะรอบ';

  if (!isNew && !Object.keys(e).length) {
    if (v.route_id !== trip.route_id && trip.booked_seats > 0) e.route_id = 'เปลี่ยนเส้นทางไม่ได้ เนื่องจากรอบนี้มีการจองแล้ว';
    if (vehicle && vehicle.seat_count < trip.booked_seats) {
      e.vehicle_id = `รถคันนี้มี ${vehicle.seat_count} ที่นั่ง น้อยกว่าที่จองแล้ว ${trip.booked_seats} ที่นั่ง`;
    }
  }

  // Conflict Validation: รถ/คนขับชนเวลา
  if (!Object.keys(e).length && v.status !== 'ยกเลิก') {
    for (const c of await findConflicts(v, trip && trip.trip_id)) {
      const range = `${c.trip_id} (${fmtTime(c.depart_time)}–${fmtTime(c.end_at)})`;
      if (c.vehicle_id === v.vehicle_id && !e.vehicle_id) {
        e.vehicle_id = `ไม่สามารถจัดรอบนี้ได้ เนื่องจากรถ ${c.plate_no} ถูกมอบหมายในรอบ ${range}`;
      }
      if (c.driver_id === v.driver_id && !e.driver_id) {
        e.driver_id = `ไม่สามารถจัดรอบนี้ได้ เนื่องจากคนขับ ${c.driver_name} มีงานรอบ ${range}`;
      }
    }
    if (e.vehicle_id || e.driver_id) e._conflict = true;
  }
  return { v, e };
}

router.get('/new', requirePerm(SCREEN.TRIPS, 'add'), (req, res) => renderForm(res, {
  values: { trip_date: req.query.date || today(), route_id: req.query.route || '' }, isNew: true,
}));

router.post('/', requirePerm(SCREEN.TRIPS, 'add'), async (req, res) => {
  const { v, e } = await validate(req.body, { isNew: true });
  if (!Object.keys(e).length) {
    try {
      const id = await db.nextId('trips', 'trip_id', 'TR', 3);
      await db.query('INSERT INTO trips SET ?', [{ trip_id: id, ...v, depart_time: `${v.depart_time}:00` }]);
      req.flash('success', `เพิ่มรอบ ${id} (${fmtDate(v.trip_date)} ${v.depart_time}) เรียบร้อยแล้ว`);
      return res.redirect(`/admin/trips?date=${v.trip_date}`);
    } catch (err) {
      if (err.sqlState !== '45000') throw err;
      e._form = db.errorMessage(err); // trigger ในฐานข้อมูลเป็นด่านสุดท้าย
    }
  }
  renderForm(res, { values: v, errors: e, isNew: true });
});

router.get('/:id/edit', requirePerm(SCREEN.TRIPS, 'edit'), async (req, res, next) => {
  const trip = await db.one(`${TRIP_SELECT} WHERE tr.trip_id = ?`, [req.params.id]);
  if (!trip) return next();
  renderForm(res, { values: trip, isNew: false, id: trip.trip_id, trip });
});

router.post('/:id', requirePerm(SCREEN.TRIPS, 'edit'), async (req, res, next) => {
  const trip = await db.one(`${TRIP_SELECT} WHERE tr.trip_id = ?`, [req.params.id]);
  if (!trip) return next();
  const { v, e } = await validate(req.body, { isNew: false, trip });
  if (!Object.keys(e).length) {
    try {
      await db.query('UPDATE trips SET ? WHERE trip_id = ?', [{ ...v, depart_time: `${v.depart_time}:00` }, trip.trip_id]);
      req.flash('success', `บันทึกรอบ ${trip.trip_id} เรียบร้อยแล้ว`);
      return res.redirect(`/admin/trips?date=${v.trip_date}`);
    } catch (err) {
      if (err.sqlState !== '45000') throw err;
      e._form = db.errorMessage(err);
    }
  }
  renderForm(res, { values: v, errors: e, isNew: false, id: trip.trip_id, trip });
});

router.post('/:id/delete', requirePerm(SCREEN.TRIPS, 'delete'), async (req, res) => {
  const id = req.params.id;
  const { n } = await db.one('SELECT COUNT(*) AS n FROM booking_items WHERE trip_id = ?', [id]);
  if (n) {
    req.flash('error', `ลบไม่ได้ เนื่องจากรอบ ${id} มีรายการจอง ${n} รายการ — เปลี่ยนสถานะรอบเป็น "ยกเลิก" แทน`);
  } else {
    await db.query('DELETE FROM trips WHERE trip_id = ?', [id]);
    req.flash('success', `ลบรอบ ${id} เรียบร้อยแล้ว`);
  }
  res.redirect(req.get('Referer') && req.get('Referer').includes('/admin/trips') ? req.get('Referer') : '/admin/trips');
});

module.exports = router;
