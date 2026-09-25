const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { ITEM_SELECT, getTrip, getTripStops, segment, routeSequences } = require('../lib/queries');
const { today, qs } = require('../lib/helpers');

const router = express.Router();
router.use(requireLogin);

// รายการที่ "กำลังจะถึง": ยืนยัน, ยังไม่ Check-in, รอบยังไม่เสร็จสิ้น/ยกเลิก
const UPCOMING = `t.status = 'ยืนยัน' AND t.checkin_at IS NULL AND tr.status IN ('เปิด', 'กำลังเดินทาง')`;

// 7.1 หน้าหลัก
router.get('/', async (req, res) => {
  const uid = req.session.user.user_id;
  const next = await db.one(
    `${ITEM_SELECT} WHERE t.user_id = ? AND ${UPCOMING} AND t.board_at >= CURDATE()
     ORDER BY t.board_at LIMIT 1`,
    [uid],
  );
  const { n } = await db.one(
    `SELECT COUNT(*) AS n FROM v_booking_item_times t JOIN trips tr ON tr.trip_id = t.trip_id
      WHERE t.user_id = ? AND ${UPCOMING}`,
    [uid],
  );
  res.page('user/home', { title: 'หน้าหลัก', next, upcomingCount: n });
});

// 7.2 ค้นหารอบรถ
router.get('/search', async (req, res) => {
  const board = req.query.board || '';
  const alight = req.query.alight || '';
  const date = req.query.date || today();
  const stops = await db.query('SELECT stop_id, stop_name FROM stops ORDER BY stop_id');
  const sequences = await routeSequences();

  let results = null;
  let error = null;
  if (req.query.board !== undefined) {
    if (!board || !alight) error = 'กรุณาเลือกจุดขึ้นและจุดลง';
    else if (board === alight) error = 'จุดขึ้นและจุดลงต้องไม่ใช่จุดเดียวกัน';
    else if (date < today()) error = 'ไม่สามารถค้นหารอบของวันที่ผ่านมาแล้ว';
    else [results] = await db.call('CALL sp_search_trips(?, ?, ?)', [date, board, alight]);
  }
  res.page('user/search', {
    title: 'ค้นหารอบรถ', stops, sequences, board, alight, date, minDate: today(), results, error,
  });
});

// รอบ + จุดขึ้น/ลงที่เลือก + เหตุผลถ้าจองไม่ได้
async function bookingContext(tripId, board, alight) {
  const trip = await getTrip(tripId);
  if (!trip) return null;
  const stops = await getTripStops(trip.trip_id);
  const seg = segment(stops, board, alight);

  let blocked = null;
  if (!seg.board || !seg.alight) blocked = 'เลือกจุดขึ้นและจุดลงจากหน้าค้นหาก่อนจอง';
  else if (trip.status !== 'เปิด') blocked = 'รอบนี้ไม่เปิดให้จอง';
  else if (!seg.board.bookable) blocked = 'ปิดรับจองแล้ว (ต้องจองก่อนรถถึงจุดขึ้นอย่างน้อย 20 นาที)';
  else if (trip.remaining_seats <= 0) blocked = 'ที่นั่งเต็ม';

  return { trip, stops, seg, blocked, maxSeats: Math.max(0, Math.min(4, trip.remaining_seats)) };
}

// 7.3 รายละเอียดรอบ
router.get('/trips/:id', async (req, res, next) => {
  const ctx = await bookingContext(req.params.id, req.query.board, req.query.alight);
  if (!ctx) return next();
  res.page('user/trip', {
    title: `รอบ ${ctx.trip.trip_id}`, ...ctx,
    bookQs: qs({ board: req.query.board, alight: req.query.alight }),
    backQs: qs({ board: req.query.board, alight: req.query.alight, date: ctx.trip.trip_date }),
  });
});

// 8.1 เลือกจำนวนที่นั่ง
router.get('/book/:id', async (req, res, next) => {
  const { board, alight } = req.query;
  const ctx = await bookingContext(req.params.id, board, alight);
  if (!ctx) return next();
  if (ctx.blocked) {
    req.flash('error', ctx.blocked);
    return res.redirect(`/trips/${ctx.trip.trip_id}${qs({ board, alight })}`);
  }
  const seats = Math.min(Math.max(1, Number(req.query.seats) || 1), ctx.maxSeats);
  res.page('user/book-seats', { title: 'เลือกจำนวนที่นั่ง', ...ctx, board, alight, seats });
});

// 8.2 ยืนยันการจอง (Summary)
router.get('/book/:id/confirm', async (req, res, next) => {
  const { board, alight } = req.query;
  const ctx = await bookingContext(req.params.id, board, alight);
  if (!ctx) return next();
  const seats = Number(req.query.seats);
  if (ctx.blocked || !(seats >= 1 && seats <= ctx.maxSeats)) {
    req.flash('error', ctx.blocked || `เลือกได้ 1–${ctx.maxSeats} ที่นั่ง`);
    return res.redirect(`/book/${ctx.trip.trip_id}${qs({ board, alight })}`);
  }
  res.page('user/book-confirm', { title: 'ยืนยันการจอง', ...ctx, board, alight, seats });
});

// สร้าง การจอง + รายการจอง + QR (procedure ตรวจที่นั่ง/เวลาอีกครั้งภายใน transaction)
router.post('/book/:id', async (req, res) => {
  const { board, alight } = req.body;
  const seats = Number(req.body.seats);
  const conn = await db.pool.getConnection();
  try {
    await conn.query('CALL sp_create_booking(?, ?, ?, ?, ?, @b, @i, @qr)',
      [req.session.user.user_id, req.params.id, board, alight, seats]);
    const [[out]] = await conn.query('SELECT @i AS item_id');
    res.redirect(`/my/items/${out.item_id}?new=1`);
  } catch (err) {
    if (!err.sqlState) throw err;
    req.flash('error', db.errorMessage(err));
    res.redirect(`/book/${encodeURIComponent(req.params.id)}${qs({ board, alight })}`);
  } finally {
    conn.release();
  }
});

// 8.3 รายละเอียดรายการจอง + QR Code (หลังจองสำเร็จ / ดู QR)
router.get('/my/items/:id', async (req, res, next) => {
  const item = await db.one(`${ITEM_SELECT} WHERE t.booking_item_id = ? AND t.user_id = ?`,
    [req.params.id, req.session.user.user_id]);
  if (!item) return next();
  const qr = await QRCode.toDataURL(item.qr_code, { width: 440, margin: 1 });
  res.page('user/item', { title: `รายการจอง ${item.booking_item_id}`, item, qr, isNew: !!req.query.new });
});

module.exports = router;
