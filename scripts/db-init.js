// สร้างฐานข้อมูลใหม่ทั้งหมดจาก database/mut_shuttle.sql แล้วเติมข้อมูลตัวอย่าง database/demo_data.sql
// ใช้:  npm run db:init              (schema + ข้อมูลตัวอย่าง)
//       npm run db:init -- --no-demo  (เฉพาะ schema + seed ตามไฟล์ SQL)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// แยกคำสั่ง SQL โดยรองรับ DELIMITER แบบเดียวกับ mysql client / phpMyAdmin
function splitSql(text) {
  const statements = [];
  let delimiter = ';';
  let buf = [];
  const hasCode = (lines) => lines.some((l) => l.trim() && !l.trim().startsWith('--'));

  for (const line of text.split(/\r?\n/)) {
    const d = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (d) { delimiter = d[1]; continue; }
    buf.push(line);
    const t = line.trimEnd();
    if (!t.trim().startsWith('--') && t.endsWith(delimiter)) {
      if (hasCode(buf)) {
        const sql = buf.join('\n').trimEnd();
        statements.push(sql.slice(0, sql.length - delimiter.length));
      }
      buf = [];
    }
  }
  if (hasCode(buf)) statements.push(buf.join('\n'));
  return statements;
}

async function runFile(conn, file) {
  const statements = splitSql(fs.readFileSync(file, 'utf8'));
  for (const sql of statements) {
    try {
      await conn.query(sql);
    } catch (err) {
      console.error(`\n✗ ${path.basename(file)} ผิดพลาดที่คำสั่ง:\n${sql.slice(0, 300)}\n→ ${err.message}`);
      throw err;
    }
  }
  console.log(`✓ ${path.basename(file)} (${statements.length} คำสั่ง)`);
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  });
  const [[ver]] = await conn.query('SELECT VERSION() AS v');
  console.log(`เชื่อมต่อ MySQL/MariaDB ${ver.v}`);

  const dir = path.join(__dirname, '..', 'database');
  await runFile(conn, path.join(dir, 'mut_shuttle.sql'));
  if (!process.argv.includes('--no-demo')) {
    await runFile(conn, path.join(dir, 'demo_data.sql'));
  }
  await conn.end();
  console.log('เสร็จแล้ว — รัน npm start แล้วเปิด http://localhost:' + (process.env.PORT || 3000));
})().catch((err) => {
  if (err.code === 'ECONNREFUSED') console.error('เชื่อมต่อ MySQL ไม่ได้ — เปิด MySQL ใน XAMPP Control Panel ก่อน');
  else console.error(err.message);
  process.exit(1);
});
