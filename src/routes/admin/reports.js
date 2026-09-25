// 11. รายงาน 1–7 (ตามเอกสาร MINI) — Summary cards + กราฟ + ตาราง + Export CSV
const express = require('express');
const db = require('../../db');
const { requireScreen, SCREEN } = require('../../middleware/auth');
const { today, DAY_NAMES, fmtTime } = require('../../lib/helpers');

const router = express.Router();
router.use(requireScreen(SCREEN.REPORTS));

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const sum = (rows, k) => rows.reduce((n, r) => n + Number(r[k] || 0), 0);
const num = (r, k) => Number(r[k] || 0);

// ช่วงวันที่เริ่มต้น = เดือนปัจจุบัน
function monthRange() {
  const t = today();
  const [y, m] = t.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${t.slice(0, 7)}-01`, to: `${t.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}

const REPORTS = {
  1: {
    title: 'เปรียบเทียบจำนวนคนขึ้น–ลงรถรายปี',
    filter: 'year',
    async run({ year }) {
      const rows = await db.query(
        `SELECT s.stop_id, s.stop_name,
                COALESCE(SUM(CASE WHEN bi.board_stop_id  = s.stop_id THEN bi.seats END), 0) AS boarded,
                COALESCE(SUM(CASE WHEN bi.alight_stop_id = s.stop_id THEN bi.seats END), 0) AS alighted
           FROM stops s
           LEFT JOIN (booking_items bi JOIN trips t ON t.trip_id = bi.trip_id)
                  ON (bi.board_stop_id = s.stop_id OR bi.alight_stop_id = s.stop_id)
                 AND bi.checkin_at IS NOT NULL AND YEAR(t.trip_date) = ?
          GROUP BY s.stop_id, s.stop_name
          ORDER BY s.stop_id`,
        [year],
      );
      return {
        note: 'นับเฉพาะผู้โดยสารที่ Check-in แล้ว (หน่วย: คน/ที่นั่ง)',
        cards: [['ขึ้นรถทั้งปี', sum(rows, 'boarded')], ['ลงรถทั้งปี', sum(rows, 'alighted')], ['จำนวนจุดจอด', rows.length]],
        columns: [{ key: 'stop_id', label: 'รหัส' }, { key: 'stop_name', label: 'จุดจอด' },
          { key: 'boarded', label: 'ขึ้นรถ', align: 'right' }, { key: 'alighted', label: 'ลงรถ', align: 'right' }],
        rows,
        totals: { stop_name: 'รวม', boarded: sum(rows, 'boarded'), alighted: sum(rows, 'alighted') },
        chart: { labels: rows.map((r) => r.stop_name),
          datasets: [{ label: 'ขึ้นรถ', data: rows.map((r) => num(r, 'boarded')) }, { label: 'ลงรถ', data: rows.map((r) => num(r, 'alighted')) }] },
      };
    },
  },

  2: {
    title: 'สถิติการจองรายปี',
    filter: 'year',
    async run({ year }) {
      const data = await db.query(
        `SELECT MONTH(t.trip_date) AS month_no,
                COUNT(DISTINCT bi.booking_id)                                  AS bookings,
                COUNT(*)                                                       AS booking_items,
                SUM(CASE WHEN bi.status <> 'ยกเลิก' THEN bi.seats ELSE 0 END)  AS booked_seats,
                SUM(bi.status = 'ยกเลิก')                                       AS cancelled,
                SUM(bi.checkin_at IS NOT NULL)                                 AS checked_in,
                SUM(bi.status = 'No Show')                                     AS no_show
           FROM booking_items bi JOIN trips t ON t.trip_id = bi.trip_id
          WHERE YEAR(t.trip_date) = ?
          GROUP BY MONTH(t.trip_date)`,
        [year],
      );
      const rows = MONTHS.map((m, i) => {
        const r = data.find((d) => d.month_no === i + 1) || {};
        return { month: m, bookings: num(r, 'bookings'), booking_items: num(r, 'booking_items'), booked_seats: num(r, 'booked_seats'),
          cancelled: num(r, 'cancelled'), checked_in: num(r, 'checked_in'), no_show: num(r, 'no_show') };
      });
      const keys = ['bookings', 'booking_items', 'booked_seats', 'cancelled', 'checked_in', 'no_show'];
      const totals = Object.fromEntries([['month', 'รวมทั้งปี'], ...keys.map((k) => [k, sum(rows, k)])]);
      return {
        note: 'จัดกลุ่มตามเดือนของวันที่เดินรถ',
        cards: [['การจอง', totals.bookings], ['รายการจอง', totals.booking_items], ['ที่นั่งที่จอง', totals.booked_seats],
          ['ยกเลิก', totals.cancelled], ['Check-in', totals.checked_in], ['No Show', totals.no_show]],
        columns: [{ key: 'month', label: 'เดือน' }, { key: 'bookings', label: 'การจอง', align: 'right' },
          { key: 'booking_items', label: 'รายการจอง', align: 'right' }, { key: 'booked_seats', label: 'ที่นั่งที่จอง', align: 'right' },
          { key: 'cancelled', label: 'ยกเลิก', align: 'right' }, { key: 'checked_in', label: 'Check-in', align: 'right' },
          { key: 'no_show', label: 'No Show', align: 'right' }],
        rows,
        totals,
        chart: { labels: MONTHS, datasets: [{ label: 'ที่นั่งที่จอง', data: rows.map((r) => r.booked_seats) }] },
      };
    },
  },

  3: {
    title: 'พฤติกรรมผู้ใช้ตามช่วงวันที่',
    filter: 'range',
    async run({ from, to }) {
      const rows = await db.query(
        `SELECT u.user_id, u.name,
                COUNT(*)                       AS total_items,
                SUM(bi.checkin_at IS NOT NULL) AS boarded,
                SUM(bi.status = 'ยกเลิก')      AS cancelled,
                SUM(bi.status = 'No Show')     AS no_show
           FROM booking_items bi
           JOIN bookings b ON b.booking_id = bi.booking_id
           JOIN users u    ON u.user_id = b.user_id
           JOIN trips t    ON t.trip_id = bi.trip_id
          WHERE t.trip_date BETWEEN ? AND ?
          GROUP BY u.user_id, u.name
          ORDER BY total_items DESC, u.user_id`,
        [from, to],
      );
      const top = rows.slice(0, 10);
      return {
        note: 'จำนวนรายการจองแยกตามผู้ใช้ (จองทั้งหมด / ขึ้นรถจริง / ยกเลิก / No Show)',
        cards: [['ผู้ใช้ที่จอง', rows.length], ['จองทั้งหมด', sum(rows, 'total_items')], ['ขึ้นรถจริง', sum(rows, 'boarded')],
          ['ยกเลิก', sum(rows, 'cancelled')], ['No Show', sum(rows, 'no_show')]],
        columns: [{ key: 'user_id', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' },
          { key: 'total_items', label: 'จองทั้งหมด', align: 'right' }, { key: 'boarded', label: 'ขึ้นรถจริง', align: 'right' },
          { key: 'cancelled', label: 'ยกเลิก', align: 'right' }, { key: 'no_show', label: 'No Show', align: 'right' }],
        rows,
        totals: { name: 'รวม', total_items: sum(rows, 'total_items'), boarded: sum(rows, 'boarded'),
          cancelled: sum(rows, 'cancelled'), no_show: sum(rows, 'no_show') },
        chart: { labels: top.map((r) => r.name), caption: 'ผู้ใช้ 10 อันดับแรก',
          datasets: [{ label: 'จองทั้งหมด', data: top.map((r) => num(r, 'total_items')) }, { label: 'ขึ้นรถจริง', data: top.map((r) => num(r, 'boarded')) }] },
      };
    },
  },

  4: {
    title: 'สรุปยอดผู้ใช้แต่ละเส้นทางรายวัน',
    filter: 'range',
    async run({ from, to }) {
      const routes = await db.query('SELECT route_id, route_name FROM routes ORDER BY route_id');
      const data = await db.query(
        `SELECT DAYOFWEEK(t.trip_date) AS dow_no, t.route_id, SUM(bi.seats) AS passengers
           FROM booking_items bi JOIN trips t ON t.trip_id = bi.trip_id
          WHERE bi.checkin_at IS NOT NULL AND t.trip_date BETWEEN ? AND ?
          GROUP BY DAYOFWEEK(t.trip_date), t.route_id`,
        [from, to],
      );
      const order = [2, 3, 4, 5, 6, 7, 1]; // จันทร์ → อาทิตย์
      const rows = order.map((dow) => {
        const r = { day: DAY_NAMES[dow - 1], total: 0 };
        for (const rt of routes) {
          const v = num(data.find((d) => d.dow_no === dow && d.route_id === rt.route_id) || {}, 'passengers');
          r[rt.route_id] = v;
          r.total += v;
        }
        return r;
      });
      const totals = { day: 'รวม', total: sum(rows, 'total') };
      routes.forEach((rt) => { totals[rt.route_id] = sum(rows, rt.route_id); });
      return {
        note: 'ผู้ใช้บริการจริง (Check-in) รวมตามวันในสัปดาห์ — วันเดียวกันในช่วงที่เลือกถูกรวมกัน',
        cards: [['ผู้ใช้บริการรวม', totals.total], ...routes.slice(0, 4).map((rt) => [rt.route_name, totals[rt.route_id]])],
        columns: [{ key: 'day', label: 'วัน' }, ...routes.map((rt) => ({ key: rt.route_id, label: rt.route_name, align: 'right' })),
          { key: 'total', label: 'รวมทั้งวัน', align: 'right' }],
        rows,
        totals,
        chart: { labels: rows.map((r) => r.day),
          datasets: routes.slice(0, 8).map((rt) => ({ label: rt.route_name, data: rows.map((r) => r[rt.route_id]) })) },
      };
    },
  },

  5: {
    title: 'การใช้บริการแต่ละจุดจอดตามรอบเวลา',
    filter: 'range',
    async run({ from, to }) {
      const rows = await db.query(
        `SELECT ts.stop_name, TIME(ts.arrive_at) AS pass_time,
                COALESCE(SUM(CASE WHEN bi.board_order  = ts.stop_order THEN bi.seats END), 0) AS boarding,
                COALESCE(SUM(CASE WHEN bi.alight_order = ts.stop_order THEN bi.seats END), 0) AS alighting
           FROM v_trip_stop_times ts
           LEFT JOIN v_booking_item_segments bi
                  ON bi.trip_id = ts.trip_id AND bi.checkin_at IS NOT NULL
                 AND (bi.board_order = ts.stop_order OR bi.alight_order = ts.stop_order)
          WHERE ts.trip_date BETWEEN ? AND ?
          GROUP BY ts.stop_name, TIME(ts.arrive_at)
          ORDER BY ts.stop_name, pass_time`,
        [from, to],
      );
      rows.forEach((r) => { r.pass_time = fmtTime(r.pass_time); });
      const byStop = [];
      for (const r of rows) {
        let s = byStop.find((x) => x.stop_name === r.stop_name);
        if (!s) byStop.push((s = { stop_name: r.stop_name, boarding: 0, alighting: 0 }));
        s.boarding += num(r, 'boarding');
        s.alighting += num(r, 'alighting');
      }
      return {
        note: 'เรียงตามจุดจอด แล้วตามเวลาที่รถผ่าน (นับเฉพาะผู้ที่ Check-in)',
        cards: [['ขึ้นรถรวม', sum(rows, 'boarding')], ['ลงรถรวม', sum(rows, 'alighting')], ['จำนวนรอบเวลา×จุดจอด', rows.length]],
        columns: [{ key: 'stop_name', label: 'จุดจอด' }, { key: 'pass_time', label: 'เวลาที่รถผ่าน' },
          { key: 'boarding', label: 'ขึ้นรถ', align: 'right' }, { key: 'alighting', label: 'ลงรถ', align: 'right' }],
        rows,
        totals: { stop_name: 'รวม', boarding: sum(rows, 'boarding'), alighting: sum(rows, 'alighting') },
        chart: { labels: byStop.map((s) => s.stop_name), caption: 'รวมทุกรอบเวลาของแต่ละจุดจอด',
          datasets: [{ label: 'ขึ้นรถ', data: byStop.map((s) => s.boarding) }, { label: 'ลงรถ', data: byStop.map((s) => s.alighting) }] },
      };
    },
  },

  6: {
    title: 'สรุปการมอบหมายงานคนขับ',
    filter: 'range',
    async run({ from, to }) {
      const rows = await db.query(
        `SELECT u.user_id, u.name,
                COUNT(*)                         AS total_trips,
                SUM(t.depart_time <  '17:00:00') AS before_1700,
                SUM(t.depart_time >= '17:00:00') AS after_1700
           FROM trips t JOIN users u ON u.user_id = t.driver_id
          WHERE t.trip_date BETWEEN ? AND ? AND t.status <> 'ยกเลิก'
          GROUP BY u.user_id, u.name
          ORDER BY total_trips DESC, u.user_id`,
        [from, to],
      );
      return {
        note: 'แบ่งตามเวลาออกของรอบ ก่อน 17:00 / ตั้งแต่ 17:00 (ไม่นับรอบที่ยกเลิก)',
        cards: [['คนขับ', rows.length], ['รอบทั้งหมด', sum(rows, 'total_trips')], ['ก่อน 17:00', sum(rows, 'before_1700')], ['หลัง 17:00', sum(rows, 'after_1700')]],
        columns: [{ key: 'user_id', label: 'รหัส' }, { key: 'name', label: 'คนขับ' },
          { key: 'before_1700', label: 'ก่อน 17:00', align: 'right' }, { key: 'after_1700', label: 'หลัง 17:00', align: 'right' },
          { key: 'total_trips', label: 'รวม', align: 'right' }],
        rows,
        totals: { name: 'รวม', before_1700: sum(rows, 'before_1700'), after_1700: sum(rows, 'after_1700'), total_trips: sum(rows, 'total_trips') },
        chart: { labels: rows.map((r) => r.name),
          datasets: [{ label: 'ก่อน 17:00', data: rows.map((r) => num(r, 'before_1700')) }, { label: 'หลัง 17:00', data: rows.map((r) => num(r, 'after_1700')) }] },
      };
    },
  },

  7: {
    title: 'จำนวนการมอบหมายงานให้รถแต่ละประเภท',
    filter: 'range',
    async run({ from, to }) {
      const data = await db.query(
        `SELECT vt.vehicle_type_id, vt.type_name, v.plate_no, COUNT(t.trip_id) AS trips
           FROM vehicle_types vt
           JOIN vehicles v   ON v.vehicle_type_id = vt.vehicle_type_id
           LEFT JOIN trips t ON t.vehicle_id = v.vehicle_id
                            AND t.trip_date BETWEEN ? AND ? AND t.status <> 'ยกเลิก'
          GROUP BY vt.vehicle_type_id, vt.type_name, v.plate_no
          ORDER BY vt.vehicle_type_id, v.plate_no`,
        [from, to],
      );
      // ประเภทรถ → ทะเบียน → จำนวนรอบ + ผลรวมต่อประเภท
      const rows = [];
      const types = [...new Set(data.map((d) => d.type_name))];
      for (const type of types) {
        const list = data.filter((d) => d.type_name === type);
        list.forEach((d) => rows.push({ type_name: d.type_name, plate_no: d.plate_no, trips: num(d, 'trips') }));
        rows.push({ type_name: `รวม${type}`, plate_no: '', trips: sum(list, 'trips'), _subtotal: true });
      }
      const detail = rows.filter((r) => !r._subtotal);
      return {
        note: 'จำนวนรอบที่รถแต่ละคันได้รับมอบหมาย (ไม่นับรอบที่ยกเลิก)',
        cards: [['รอบทั้งหมด', sum(detail, 'trips')], ...types.slice(0, 4).map((t) => [t, sum(detail.filter((r) => r.type_name === t), 'trips')])],
        columns: [{ key: 'type_name', label: 'ประเภทรถ' }, { key: 'plate_no', label: 'ทะเบียน' }, { key: 'trips', label: 'จำนวนรอบ', align: 'right' }],
        rows,
        totals: { type_name: 'รวมทั้งหมด', trips: sum(detail, 'trips') },
        chart: { labels: detail.map((r) => `${r.plate_no} (${r.type_name})`), datasets: [{ label: 'จำนวนรอบ', data: detail.map((r) => r.trips) }] },
      };
    },
  },
};

function toCsv(result) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [result.columns.map((c) => esc(c.label)).join(',')];
  for (const r of [...result.rows, result.totals]) lines.push(result.columns.map((c) => esc(r[c.key])).join(','));
  return `﻿${lines.join('\r\n')}`; // BOM ให้ Excel อ่านภาษาไทยได้
}

router.get('/', async (req, res) => {
  const id = REPORTS[req.query.r] ? Number(req.query.r) : 1;
  const report = REPORTS[id];
  const range = monthRange();
  const params = {
    year: Number(req.query.year) || Number(today().slice(0, 4)),
    from: /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : range.from,
    to: /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : range.to,
  };
  if (params.from > params.to) [params.from, params.to] = [params.to, params.from];
  const result = await report.run(params);

  if (req.query.export === 'csv') {
    const suffix = report.filter === 'year' ? params.year : `${params.from}_${params.to}`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="report-${id}-${suffix}.csv"`);
    return res.send(toCsv(result));
  }
  const reports = Object.entries(REPORTS).map(([k, r]) => ({ id: Number(k), title: r.title }));
  res.page('admin/reports', { title: `รายงาน ${id}`, id, report, params, result, reports });
});

module.exports = router;
