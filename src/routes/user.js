const express = require('express');
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

// 7.3 รายละเอียดรอบ
router.get('/trips/:id', async (req, res, next) => {
  const trip = await getTrip(req.params.id);
  if (!trip) return next();
  const stops = await getTripStops(trip.trip_id);
  const seg = segment(stops, req.query.board, req.query.alight);

  let blocked = null;
  if (!seg.board || !seg.alight) blocked = 'เลือกจุดขึ้นและจุดลงจากหน้าค้นหาก่อนจอง';
  else if (trip.status !== 'เปิด') blocked = 'รอบนี้ไม่เปิดให้จอง';
  else if (!seg.board.bookable) blocked = 'ปิดรับจองแล้ว (ต้องจองก่อนรถถึงจุดขึ้นอย่างน้อย 20 นาที)';
  else if (trip.remaining_seats <= 0) blocked = 'ที่นั่งเต็ม';

  res.page('user/trip', {
    title: `รอบ ${trip.trip_id}`, trip, stops, seg, blocked,
    bookQs: qs({ board: req.query.board, alight: req.query.alight }),
    backQs: qs({ board: req.query.board, alight: req.query.alight, date: trip.trip_date }),
  });
});

module.exports = router;
