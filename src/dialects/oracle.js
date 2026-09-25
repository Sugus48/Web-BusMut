// Oracle (node-oracledb, Thin mode — ไม่ต้องติดตั้ง Oracle Client)
// SQL ในแอปเขียนแบบ MySQL แล้วแปลงเป็น Oracle ที่นี่ (placeholder, LIMIT, ฟังก์ชันวันเวลา, view)
const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let poolPromise = null;
function getPool() {
  poolPromise ||= oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: `${process.env.DB_HOST}:${process.env.DB_PORT || 1521}/${process.env.DB_SERVICE}`,
    poolMin: 0,
    poolMax: 10,
    // string 'YYYY-MM-DD' เทียบกับคอลัมน์ DATE ได้โดยตรง
    sessionCallback: (conn, tag, cb) => {
      conn.execute("ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'").then(() => cb(), cb);
    },
  }).catch((err) => { poolPromise = null; throw normalize(err); });
  return poolPromise;
}

// ---------------------------------------------------------------------
// View (บัญชีไม่มีสิทธิ์ CREATE VIEW) → แทนที่ด้วย subquery ที่นิยามเหมือน mut_shuttle.sql
// ---------------------------------------------------------------------
const VIEWS = {
  v_route_totals: `
    SELECT r.route_id, r.route_name,
           COUNT(rs.stop_order) AS stop_count, COALESCE(SUM(rs.travel_minutes), 0) AS total_minutes
      FROM routes r LEFT JOIN route_stops rs ON rs.route_id = r.route_id
     GROUP BY r.route_id, r.route_name`,
  v_route_stop_times: `
    SELECT rs.route_id, rs.stop_order, rs.stop_id, s.stop_name, rs.travel_minutes,
           SUM(rs.travel_minutes) OVER (PARTITION BY rs.route_id ORDER BY rs.stop_order
                                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_minutes
      FROM route_stops rs JOIN stops s ON s.stop_id = rs.stop_id`,
  v_trip_stop_times: `
    SELECT t.trip_id, t.trip_date, t.depart_time, t.route_id,
           st.stop_order, st.stop_id, st.stop_name, st.cum_minutes,
           mut_ts(t.trip_date, t.depart_time) + st.cum_minutes / 1440 AS arrive_at
      FROM trips t JOIN v_route_stop_times st ON st.route_id = t.route_id`,
  v_trip_seats: `
    SELECT t.trip_id, t.seat_count,
           COALESCE(SUM(CASE WHEN bi.status <> 'ยกเลิก' THEN bi.seats END), 0) AS booked_seats,
           t.seat_count - COALESCE(SUM(CASE WHEN bi.status <> 'ยกเลิก' THEN bi.seats END), 0) AS remaining_seats
      FROM trips t LEFT JOIN booking_items bi ON bi.trip_id = t.trip_id
     GROUP BY t.trip_id, t.seat_count`,
  v_booking_item_segments: `
    SELECT bi.booking_item_id, bi.booking_id, bi.trip_id, bi.status, bi.seats, bi.checkin_at,
           bi.board_stop_id, bi.alight_stop_id, t.route_id,
           (SELECT MIN(a.stop_order) FROM route_stops a
             WHERE a.route_id = t.route_id AND a.stop_id = bi.board_stop_id) AS board_order,
           (SELECT MIN(b.stop_order) FROM route_stops b
             WHERE b.route_id = t.route_id AND b.stop_id = bi.alight_stop_id
               AND b.stop_order > (SELECT MIN(a2.stop_order) FROM route_stops a2
                                    WHERE a2.route_id = t.route_id AND a2.stop_id = bi.board_stop_id)) AS alight_order
      FROM booking_items bi JOIN trips t ON t.trip_id = bi.trip_id`,
  v_booking_item_times: `
    SELECT sg.*, u.user_id, u.name AS passenger_name, tb.arrive_at AS board_at, ta.arrive_at AS alight_at
      FROM v_booking_item_segments sg
      JOIN bookings b ON b.booking_id = sg.booking_id
      JOIN users u    ON u.user_id = b.user_id
      JOIN v_trip_stop_times tb ON tb.trip_id = sg.trip_id AND tb.stop_order = sg.board_order
      LEFT JOIN v_trip_stop_times ta ON ta.trip_id = sg.trip_id AND ta.stop_order = sg.alight_order`,
};
const VIEW_PATTERN = `\\b(${Object.keys(VIEWS).join('|')})\\b`;
const expandViews = (sql) => (new RegExp(VIEW_PATTERN).test(sql)
  ? expandViews(sql.replace(new RegExp(VIEW_PATTERN, 'g'), (m) => `(${VIEWS[m]})`))
  : sql);

// MySQL → Oracle
function translate(sql) {
  let s = expandViews(sql);
  s = s
    .replace(/\bTIMESTAMP\(/g, 'mut_ts(')
    .replace(/\bCURDATE\(\)/g, 'TRUNC(SYSDATE)')
    .replace(/\bNOW\(\)/g, 'SYSDATE')
    .replace(/\bINTERVAL\s+([\w.?]+)\s+MINUTE\b/g, '($1) / 1440')
    .replace(/\bINTERVAL\s+([\w.?]+)\s+HOUR\b/g, '($1) / 24')
    .replace(/\bINTERVAL\s+([\w.?]+)\s+DAY\b/g, '($1)')
    .replace(/\bDATE\(([^()]+)\)/g, 'TRUNC($1)')
    .replace(/\bYEAR\(([^()]+)\)/g, 'EXTRACT(YEAR FROM $1)')
    .replace(/\bMONTH\(([^()]+)\)/g, 'EXTRACT(MONTH FROM $1)')
    .replace(/\bDAYOFWEEK\(([^()]+)\)/g, "(MOD(TRUNC($1) - TRUNC($1, 'IW') + 1, 7) + 1)") // 1 = อาทิตย์ แบบ MySQL
    .replace(/\bTIME\(([^()]+)\)/g, "TO_CHAR($1, 'HH24:MI:SS')")
    .replace(/\bLIMIT\s+(\d+)/g, 'FETCH FIRST $1 ROWS ONLY');
  let n = 0;
  return s.replace(/\?/g, () => `:${++n}`);
}

// DATE → string แบบเดียวกับ mysql2 dateStrings (trip_date เป็นวันที่อย่างเดียว)
const pad = (v) => String(v).padStart(2, '0');
function fmtDate(d, key) {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return key === 'trip_date' ? date : `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function convRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.toLowerCase();
    out[key] = v instanceof Date ? fmtDate(v, key) : v;
  }
  return out;
}

// error ของ Oracle → รูปแบบเดียวกับ MySQL เพื่อให้โค้ดส่วนอื่นใช้ร่วมกันได้
const ERRNO = { 1: 1062, 2292: 1451, 2291: 1452, 2290: 3819, 1400: 3819, 12899: 3819 };
function normalize(err) {
  if (!err || err.normalized) return err;
  err.normalized = true;
  const num = err.errorNum;
  if (num >= 20000 && num <= 20999) {
    err.sqlState = '45000';
    err.sqlMessage = String(err.message).split('\n')[0].replace(/^ORA-\d+:\s*/, '');
  } else if (ERRNO[num]) {
    err.errno = ERRNO[num];
    err.sqlState = '23000';
    err.sqlMessage = err.message;
  } else if (/^(NJS-5\d\d|ORA-12\d\d\d|ORA-01017|ORA-28000)/.test(err.code || err.message)) {
    err.code = 'ECONNREFUSED';
  }
  return err;
}

async function withConn(fn) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } catch (err) {
    throw normalize(err);
  } finally {
    await conn.close();
  }
}

async function exec(conn, sql, params, autoCommit) {
  const binds = params.map((v) => (v === undefined ? null : v));
  const r = await conn.execute(translate(sql), binds, { autoCommit });
  return r.rows ? r.rows.map(convRow) : { affectedRows: r.rowsAffected };
}

async function query(sql, params = [], conn = null) {
  if (conn) {
    try { return await exec(conn, sql, params, false); } catch (err) { throw normalize(err); }
  }
  return withConn((c) => exec(c, sql, params, true));
}

async function tx(fn) {
  return withConn(async (conn) => {
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  });
}

async function nextId(table, col, prefix, pad, conn = null) {
  const [row] = await query(
    `SELECT NVL(MAX(TO_NUMBER(SUBSTR(${col}, ${prefix.length + 1}))), 0) + 1 AS n
       FROM ${table} WHERE REGEXP_LIKE(${col}, '^${prefix}[0-9]+$')`,
    [],
    conn,
  );
  return prefix + String(row.n).padStart(pad, '0');
}

async function readCursor(rs) {
  const rows = await rs.getRows();
  await rs.close();
  return rows.map(convRow);
}

const OUT_CURSOR = { type: oracledb.CURSOR, dir: oracledb.BIND_OUT };
const OUT_STR = { type: oracledb.STRING, dir: oracledb.BIND_OUT, maxSize: 64 };

// Stored procedures (ชื่อ/พารามิเตอร์ตรงกับฉบับ MySQL)
const proc = {
  searchTrips: (date, board, alight) => withConn(async (c) => {
    const r = await c.execute("BEGIN sp_search_trips(TO_DATE(:d, 'YYYY-MM-DD'), :b, :a, :rc); END;",
      { d: date, b: board, a: alight, rc: OUT_CURSOR });
    return readCursor(r.outBinds.rc);
  }),
  createBooking: ({ user, trip, board, alight, seats }) => withConn(async (c) => {
    const r = await c.execute('BEGIN sp_create_booking(:u, :t, :b, :a, :s, :bid, :iid, :qr); END;',
      { u: user, t: trip, b: board, a: alight, s: seats, bid: OUT_STR, iid: OUT_STR, qr: OUT_STR }, { autoCommit: true });
    return { booking_id: r.outBinds.bid, item_id: r.outBinds.iid, qr: r.outBinds.qr };
  }),
  cancelItem: (item, user) => withConn((c) => c.execute('BEGIN sp_cancel_booking_item(:i, :u); END;',
    { i: item, u: user }, { autoCommit: true })),
  startTrip: (trip, driver) => withConn((c) => c.execute('BEGIN sp_start_trip(:t, :d); END;',
    { t: trip, d: driver }, { autoCommit: true })),
  checkin: (qr, trip) => withConn(async (c) => {
    const r = await c.execute('BEGIN sp_checkin(:q, :t, :rc); END;', { q: qr, t: trip, rc: OUT_CURSOR }, { autoCommit: true });
    return (await readCursor(r.outBinds.rc))[0];
  }),
  closeTrip: (trip) => withConn(async (c) => {
    const r = await c.execute('BEGIN sp_close_trip(:t, :s, :n); END;',
      { t: trip, s: OUT_CURSOR, n: OUT_CURSOR }, { autoCommit: true });
    return { summary: (await readCursor(r.outBinds.s))[0], noShows: await readCursor(r.outBinds.n) };
  }),
};

async function end() {
  if (poolPromise) await (await poolPromise).close(0);
}

module.exports = { client: 'oracle', query, tx, nextId, proc, translate, end, getPool, normalize };
