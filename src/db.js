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

async function query(sql, params = [], conn = pool) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

async function one(sql, params = [], conn = pool) {
  const rows = await query(sql, params, conn);
  return rows[0] || null;
}

// CALL คืนค่า [resultSet1, resultSet2, ..., OkPacket] — เก็บเฉพาะ result set
async function call(sql, params = [], conn = pool) {
  const [res] = await conn.query(sql, params);
  return Array.isArray(res) ? res.filter(Array.isArray) : [];
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

// รหัสถัดไป เช่น nextId('stops', 'stop_id', 'S', 3) → S005
// table/col มาจากโค้ดเท่านั้น (ไม่รับจากผู้ใช้)
async function nextId(table, col, prefix, pad, conn = pool) {
  const row = await one(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${col}, ?) AS UNSIGNED)), 0) + 1 AS n
       FROM ${table} WHERE ${col} LIKE ?`,
    [prefix.length + 1, prefix + '%'],
    conn,
  );
  return prefix + String(row.n).padStart(pad, '0');
}

// แปลง error จาก MySQL เป็นข้อความภาษาไทยสำหรับแสดงผู้ใช้
function errorMessage(err) {
  if (!err) return '';
  if (err.sqlState === '45000') return err.sqlMessage; // SIGNAL จาก trigger / procedure
  switch (err.errno) {
    case 1062: return 'ข้อมูลซ้ำกับที่มีอยู่แล้วในระบบ';
    case 1451: return 'ลบไม่ได้ เนื่องจากข้อมูลนี้ถูกใช้งานอยู่ในส่วนอื่นของระบบ';
    case 1452: return 'ข้อมูลอ้างอิงไม่ถูกต้อง (ไม่พบข้อมูลที่เลือก)';
    case 3819:
    case 4025: return 'ข้อมูลไม่ผ่านเงื่อนไขที่กำหนด';
    default: break;
  }
  if (['ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ETIMEDOUT'].includes(err.code)) {
    return 'เชื่อมต่อฐานข้อมูลไม่ได้ — ตรวจสอบว่าเปิด MySQL แล้ว และค่าในไฟล์ .env ถูกต้อง';
  }
  return 'เกิดข้อผิดพลาดของระบบ';
}

module.exports = { pool, query, one, call, tx, nextId, errorMessage };
