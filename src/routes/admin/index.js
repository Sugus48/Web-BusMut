const express = require('express');
const db = require('../../db');
const { requireLogin, requireAnyAdmin } = require('../../middleware/auth');
const { TRIP_SELECT, ITEM_SELECT } = require('../../lib/queries');

const router = express.Router();
router.use(requireLogin);

// 10.1 Dashboard
router.get('/', requireAnyAdmin, async (req, res) => {
  const kpi = await db.one(`
    SELECT
      (SELECT COUNT(*) FROM booking_items bi JOIN bookings b ON b.booking_id = bi.booking_id
        WHERE DATE(b.booked_at) = CURDATE())                                                   AS items_today,
      (SELECT COUNT(*) FROM trips WHERE trip_date = CURDATE() AND status <> 'ยกเลิก')          AS trips_today,
      (SELECT COALESCE(SUM(bi.seats), 0) FROM booking_items bi JOIN trips t ON t.trip_id = bi.trip_id
        WHERE t.trip_date = CURDATE() AND bi.status <> 'ยกเลิก')                               AS seats_today,
      (SELECT COALESCE(SUM(bi.seats), 0) FROM booking_items bi JOIN trips t ON t.trip_id = bi.trip_id
        WHERE t.trip_date = CURDATE() AND bi.checkin_at IS NOT NULL)                            AS checkin_today,
      (SELECT COUNT(*) FROM booking_items bi JOIN trips t ON t.trip_id = bi.trip_id
        WHERE t.trip_date = CURDATE() AND bi.status = 'No Show')                               AS noshow_today,
      (SELECT COUNT(*) FROM vehicles WHERE status = 'พร้อมใช้งาน')                               AS vehicles_ready,
      (SELECT COUNT(*) FROM vehicles)                                                           AS vehicles_total`);
  const trips = await db.query(`${TRIP_SELECT} WHERE tr.trip_date = CURDATE() ORDER BY tr.depart_time`);
  const latest = await db.query(`${ITEM_SELECT} ORDER BY b.booked_at DESC, t.booking_item_id DESC LIMIT 8`);
  res.page('admin/dashboard', { title: 'Dashboard', kpi, trips, latest });
});

// ข้อมูลหลัก (CRUD มาตรฐาน)
const crud = require('./crud');
const resources = require('./resources');

for (const [path, cfg] of Object.entries(resources)) router.use(path, crud(cfg));

module.exports = router;
