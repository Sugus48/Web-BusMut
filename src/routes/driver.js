const express = require('express');
const db = require('../db');
const { requireLogin, requireScreen, denied, SCREEN } = require('../middleware/auth');
const { TRIP_SELECT, getTrip } = require('../lib/queries');

const router = express.Router();
router.use(requireLogin, requireScreen(SCREEN.DRIVER));

// รอบของคนขับที่ login อยู่เท่านั้น
async function myTrip(req, res) {
  const trip = await getTrip(req.params.id);
  if (!trip) return null;
  if (trip.driver_id !== req.session.user.user_id) {
    denied(res);
    return false;
  }
  return trip;
}

// ผู้โดยสารขึ้น/ลงตามลำดับจุดจอด (ไม่นับรายการที่ยกเลิก)
async function passengersByStop(tripId) {
  const rows = await db.query(
    `SELECT ts.stop_order, ts.stop_name, ts.arrive_at,
            bi.booking_item_id, bi.passenger_name, bi.seats, bi.checkin_at, bi.status,
            bi.board_order, bi.alight_order
       FROM v_trip_stop_times ts
       LEFT JOIN v_booking_item_times bi
              ON bi.trip_id = ts.trip_id AND bi.status <> 'ยกเลิก'
             AND (bi.board_order = ts.stop_order OR bi.alight_order = ts.stop_order)
      WHERE ts.trip_id = ?
      ORDER BY ts.stop_order, bi.booking_item_id`,
    [tripId],
  );
  const stops = [];
  for (const r of rows) {
    let s = stops[stops.length - 1];
    if (!s || s.stop_order !== r.stop_order) {
      s = { stop_order: r.stop_order, stop_name: r.stop_name, arrive_at: r.arrive_at, up: [], down: [] };
      stops.push(s);
    }
    if (!r.booking_item_id) continue;
    if (r.board_order === r.stop_order) s.up.push(r);
    if (r.alight_order === r.stop_order) s.down.push(r);
  }
  for (const s of stops) {
    s.upSeats = s.up.reduce((n, p) => n + p.seats, 0);
    s.downSeats = s.down.reduce((n, p) => n + p.seats, 0);
  }
  return stops;
}

async function tripCounts(tripId) {
  return db.one(
    `SELECT COALESCE(SUM(seats), 0) AS booked,
            COALESCE(SUM(CASE WHEN checkin_at IS NOT NULL THEN seats END), 0) AS checked_in,
            COALESCE(SUM(CASE WHEN checkin_at IS NULL AND status = 'ยืนยัน' THEN seats END), 0) AS waiting,
            COALESCE(SUM(CASE WHEN status = 'No Show' THEN seats END), 0) AS no_show
       FROM booking_items WHERE trip_id = ? AND status <> 'ยกเลิก'`,
    [tripId],
  );
}

// 9.1 งานวันนี้
router.get('/', async (req, res) => {
  const trips = await db.query(
    `${TRIP_SELECT} WHERE tr.driver_id = ? AND tr.trip_date = CURDATE() ORDER BY tr.depart_time`,
    [req.session.user.user_id],
  );
  res.page('driver/today', { title: 'งานวันนี้', trips });
});

// 9.2 รายละเอียดรอบ + ผู้โดยสารตามจุดจอด
router.get('/trips/:id', async (req, res, next) => {
  const trip = await myTrip(req, res);
  if (trip === null) return next();
  if (!trip) return;
  const stops = await passengersByStop(trip.trip_id);
  const counts = await tripCounts(trip.trip_id);
  res.page('driver/trip', { title: `รอบ ${trip.trip_id}`, trip, stops, counts });
});

// เริ่มการเดินทาง
router.post('/trips/:id/start', async (req, res) => {
  try {
    await db.call('CALL sp_start_trip(?, ?)', [req.params.id, req.session.user.user_id]);
    req.flash('success', 'เริ่มการเดินทางแล้ว — สแกน QR ผู้โดยสารได้เลย');
  } catch (err) {
    if (!err.sqlState) throw err;
    req.flash('error', db.errorMessage(err));
  }
  res.redirect(`/driver/trips/${encodeURIComponent(req.params.id)}`);
});

// 9.3 สแกน QR (Check-in)
router.get('/trips/:id/scan', async (req, res, next) => {
  const trip = await myTrip(req, res);
  if (trip === null) return next();
  if (!trip) return;
  const result = req.session.scanResult || null;
  delete req.session.scanResult;
  const counts = await tripCounts(trip.trip_id);
  res.page('driver/scan', { title: 'สแกน QR', trip, counts, result });
});

router.post('/trips/:id/checkin', async (req, res, next) => {
  const trip = await myTrip(req, res);
  if (trip === null) return next();
  if (!trip) return;
  const qr = String(req.body.qr || '').trim();
  if (!qr) {
    req.session.scanResult = { ok: false, msg: 'กรุณาสแกนหรือกรอกรหัส QR' };
  } else {
    try {
      const [[r]] = await db.call('CALL sp_checkin(?, ?)', [qr, trip.trip_id]);
      req.session.scanResult = {
        ok: true,
        msg: `Check-in สำเร็จ — ${r.passenger_name} ${r.seats} ที่นั่ง (ลงที่ ${r.alight_stop})`,
      };
    } catch (err) {
      if (!err.sqlState) throw err;
      req.session.scanResult = { ok: false, msg: db.errorMessage(err), qr };
    }
  }
  res.redirect(`/driver/trips/${trip.trip_id}/scan`);
});

// 9.4 ปิดงาน — หน้าสรุปก่อนยืนยัน
router.get('/trips/:id/close', async (req, res, next) => {
  const trip = await myTrip(req, res);
  if (trip === null) return next();
  if (!trip) return;
  if (trip.status !== 'กำลังเดินทาง') {
    req.flash('error', 'ปิดงานได้เฉพาะรอบที่กำลังเดินทาง');
    return res.redirect(`/driver/trips/${trip.trip_id}`);
  }
  const counts = await tripCounts(trip.trip_id);
  const noShows = await db.query(
    `SELECT t.booking_item_id, t.passenger_name, t.seats, s.stop_name AS board_stop, t.board_at
       FROM v_booking_item_times t JOIN stops s ON s.stop_id = t.board_stop_id
      WHERE t.trip_id = ? AND t.status = 'ยืนยัน' AND t.checkin_at IS NULL
      ORDER BY t.board_at`,
    [trip.trip_id],
  );
  res.page('driver/close', { title: 'ปิดงาน', trip, counts, noShows });
});

router.post('/trips/:id/close', async (req, res, next) => {
  const trip = await myTrip(req, res);
  if (trip === null) return next();
  if (!trip) return;
  try {
    const [[summary]] = await db.call('CALL sp_close_trip(?)', [trip.trip_id]);
    req.flash('success', `ปิดงานแล้ว — ผู้ใช้บริการจริง ${summary.actual_passengers} คน, No Show ${summary.no_show_items || 0} รายการ`);
  } catch (err) {
    if (!err.sqlState) throw err;
    req.flash('error', db.errorMessage(err));
  }
  res.redirect(`/driver/trips/${trip.trip_id}`);
});

// 9.5 ประวัติรอบที่ขับ
router.get('/history', async (req, res) => {
  const trips = await db.query(
    `SELECT tr.trip_id, tr.trip_date, tr.depart_time, tr.status, r.route_name, v.plate_no, vt.type_name,
            COALESCE(SUM(CASE WHEN bi.status <> 'ยกเลิก' THEN bi.seats END), 0) AS booked,
            COALESCE(SUM(CASE WHEN bi.checkin_at IS NOT NULL THEN bi.seats END), 0) AS actual,
            COALESCE(SUM(CASE WHEN bi.status = 'No Show' THEN bi.seats END), 0) AS no_show
       FROM trips tr
       JOIN routes r         ON r.route_id = tr.route_id
       JOIN vehicles v       ON v.vehicle_id = tr.vehicle_id
       JOIN vehicle_types vt ON vt.vehicle_type_id = v.vehicle_type_id
       LEFT JOIN booking_items bi ON bi.trip_id = tr.trip_id
      WHERE tr.driver_id = ? AND (tr.trip_date < CURDATE() OR tr.status IN ('เสร็จสิ้น', 'ยกเลิก'))
      GROUP BY tr.trip_id, tr.trip_date, tr.depart_time, tr.status, r.route_name, v.plate_no, vt.type_name
      ORDER BY tr.trip_date DESC, tr.depart_time DESC
      LIMIT 200`,
    [req.session.user.user_id],
  );
  res.page('driver/history', { title: 'ประวัติรอบที่ขับ', trips });
});

module.exports = router;
