const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { ITEM_SELECT } = require('../lib/queries');

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

module.exports = router;
