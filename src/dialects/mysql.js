// MySQL / MariaDB (mysql2)
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'mut_shuttle',
  charset: 'utf8mb4',
  dateStrings: true, // DATE/TIME/DATETIME เป็น string ตามเวลาในฐานข้อมูล ไม่แปลง timezone
  waitForConnections: true,
  connectionLimit: 10,
});

async function query(sql, params = [], conn = null) {
  const [rows] = await (conn || pool).query(sql, params);
  return rows;
}

async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// table/col มาจากโค้ดเท่านั้น (ไม่รับจากผู้ใช้)
async function nextId(table, col, prefix, pad, conn = null) {
  const [row] = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${col}, ?) AS UNSIGNED)), 0) + 1 AS n
       FROM ${table} WHERE ${col} LIKE ?`,
    [prefix.length + 1, prefix + '%'],
    conn,
  );
  return prefix + String(row.n).padStart(pad, '0');
}

// CALL คืนค่า [resultSet1, resultSet2, ..., OkPacket] — เก็บเฉพาะ result set
async function call(sql, params) {
  const [res] = await pool.query(sql, params);
  return Array.isArray(res) ? res.filter(Array.isArray) : [];
}

// Stored procedures (ชื่อ/พารามิเตอร์ตรงกับฉบับ Oracle)
const proc = {
  async searchTrips(date, board, alight) {
    const [rows] = await call('CALL sp_search_trips(?, ?, ?)', [date, board, alight]);
    return rows;
  },
  async createBooking({ user, trip, board, alight, seats }) {
    const conn = await pool.getConnection();
    try {
      await conn.query('CALL sp_create_booking(?, ?, ?, ?, ?, @b, @i, @qr)', [user, trip, board, alight, seats]);
      const [[out]] = await conn.query('SELECT @b AS booking_id, @i AS item_id, @qr AS qr');
      return out;
    } finally {
      conn.release();
    }
  },
  cancelItem: (item, user) => call('CALL sp_cancel_booking_item(?, ?)', [item, user]),
  startTrip: (trip, driver) => call('CALL sp_start_trip(?, ?)', [trip, driver]),
  async checkin(qr, trip) {
    const [[row]] = await call('CALL sp_checkin(?, ?)', [qr, trip]);
    return row;
  },
  async closeTrip(trip) {
    const [[summary], noShows] = await call('CALL sp_close_trip(?)', [trip]);
    return { summary, noShows };
  },
};

module.exports = { client: 'mysql', query, tx, nextId, proc, end: () => pool.end() };
