// ชั้นเชื่อมต่อฐานข้อมูล — เลือก MySQL หรือ Oracle ด้วย DB_CLIENT ใน .env
// SQL ในแอปเขียนแบบ MySQL และใช้เฉพาะรูปแบบที่ dialects/oracle.js แปลงได้
const client = (process.env.DB_CLIENT || 'mysql').toLowerCase();
const driver = require(client === 'oracle' ? './dialects/oracle' : './dialects/mysql');

const { query, tx, nextId, proc } = driver;

async function one(sql, params = [], conn = null) {
  const rows = await query(sql, params, conn);
  return rows[0] || null;
}

function insert(table, data, conn = null) {
  const cols = Object.keys(data);
  return query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => data[c]),
    conn,
  );
}

function update(table, data, where, conn = null) {
  const cols = Object.keys(data);
  const keys = Object.keys(where);
  return query(
    `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}`,
    [...cols.map((c) => data[c]), ...keys.map((k) => where[k])],
    conn,
  );
}

// แปลง error จากฐานข้อมูลเป็นข้อความภาษาไทยสำหรับแสดงผู้ใช้
function errorMessage(err) {
  if (!err) return '';
  if (err.sqlState === '45000') return err.sqlMessage; // SIGNAL / RAISE_APPLICATION_ERROR
  switch (err.errno) {
    case 1062: return 'ข้อมูลซ้ำกับที่มีอยู่แล้วในระบบ';
    case 1451: return 'ลบไม่ได้ เนื่องจากข้อมูลนี้ถูกใช้งานอยู่ในส่วนอื่นของระบบ';
    case 1452: return 'ข้อมูลอ้างอิงไม่ถูกต้อง (ไม่พบข้อมูลที่เลือก)';
    case 3819:
    case 4025: return 'ข้อมูลไม่ผ่านเงื่อนไขที่กำหนด';
    default: break;
  }
  if (['ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ETIMEDOUT'].includes(err.code)) {
    return 'เชื่อมต่อฐานข้อมูลไม่ได้ — ตรวจสอบว่าฐานข้อมูลเปิดอยู่ และค่าในไฟล์ .env ถูกต้อง';
  }
  return 'เกิดข้อผิดพลาดของระบบ';
}

module.exports = { client, query, one, tx, nextId, insert, update, proc, errorMessage, end: driver.end };
