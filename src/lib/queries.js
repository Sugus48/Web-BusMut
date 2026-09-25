// SQL ที่ใช้ซ้ำหลายหน้า
const db = require('../db');

// รายการจอง + ข้อมูลรอบ/เส้นทาง/รถ/จุดจอด (อิง view v_booking_item_times)
const ITEM_SELECT = `
SELECT t.booking_item_id, t.booking_id, t.trip_id, t.seats, t.status, t.checkin_at,
       t.board_at, t.alight_at, t.user_id, t.passenger_name,
       t.board_stop_id, t.alight_stop_id, sb.stop_name AS board_stop, sa.stop_name AS alight_stop,
       tr.trip_date, tr.depart_time, tr.status AS trip_status, tr.route_id, r.route_name,
       v.plate_no, vt.type_name, bi.qr_code, b.booked_at
FROM v_booking_item_times t
JOIN booking_items bi ON bi.booking_item_id = t.booking_item_id
JOIN bookings b       ON b.booking_id = t.booking_id
JOIN trips tr         ON tr.trip_id = t.trip_id
JOIN routes r         ON r.route_id = tr.route_id
JOIN vehicles v       ON v.vehicle_id = tr.vehicle_id
JOIN vehicle_types vt ON vt.vehicle_type_id = v.vehicle_type_id
JOIN stops sb         ON sb.stop_id = t.board_stop_id
JOIN stops sa         ON sa.stop_id = t.alight_stop_id`;

// รอบการเดินรถ + เส้นทาง/รถ/คนขับ/ที่นั่ง/เวลารวม
const TRIP_SELECT = `
SELECT tr.trip_id, tr.trip_date, tr.depart_time, tr.status, tr.route_id, tr.vehicle_id, tr.driver_id,
       r.route_name, v.plate_no, vt.type_name, s.seat_count, s.booked_seats, s.remaining_seats,
       rt.total_minutes, u.name AS driver_name,
       TIMESTAMP(tr.trip_date, tr.depart_time) + INTERVAL rt.total_minutes MINUTE AS end_at
FROM trips tr
JOIN routes r         ON r.route_id = tr.route_id
JOIN v_route_totals rt ON rt.route_id = tr.route_id
JOIN vehicles v       ON v.vehicle_id = tr.vehicle_id
JOIN vehicle_types vt ON vt.vehicle_type_id = v.vehicle_type_id
JOIN v_trip_seats s   ON s.trip_id = tr.trip_id
JOIN users u          ON u.user_id = tr.driver_id`;

const getTrip = (tripId) => db.one(`${TRIP_SELECT} WHERE tr.trip_id = ?`, [tripId]);

// เวลาถึงแต่ละจุดจอดของรอบ (Route diagram)
const getTripStops = (tripId) => db.query(
  `SELECT stop_order, stop_id, stop_name, cum_minutes, arrive_at,
          arrive_at >= NOW() + INTERVAL 20 MINUTE AS bookable
     FROM v_trip_stop_times WHERE trip_id = ? ORDER BY stop_order`,
  [tripId],
);

// ลำดับจุดขึ้น = ลำดับแรกที่ตรง, จุดลง = ลำดับแรกหลังจุดขึ้น (ตรงกับ v_booking_item_segments)
function segment(stops, boardId, alightId) {
  const b = stops.find((s) => s.stop_id === boardId);
  const a = b ? stops.find((s) => s.stop_id === alightId && s.stop_order > b.stop_order) : null;
  return { board: b || null, alight: a || null };
}

// ลำดับจุดจอดของทุกเส้นทาง ใช้จำกัดตัวเลือกจุดลงให้อยู่หลังจุดขึ้น
async function routeSequences() {
  const rows = await db.query('SELECT route_id, stop_id FROM route_stops ORDER BY route_id, stop_order');
  const seq = {};
  for (const r of rows) (seq[r.route_id] ||= []).push(r.stop_id);
  return Object.values(seq);
}

module.exports = { ITEM_SELECT, TRIP_SELECT, getTrip, getTripStops, segment, routeSequences };
