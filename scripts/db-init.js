// สร้างฐานข้อมูลใหม่จากไฟล์ SQL แล้วเติมข้อมูลตัวอย่าง (เลือกตาม DB_CLIENT ใน .env)
//   MySQL : database/mut_shuttle.sql        + database/demo_data.sql
//   Oracle: database/mut_shuttle_oracle.sql + database/demo_data_oracle.sql
// ใช้:  npm run db:init              (schema + ข้อมูลตัวอย่าง)
//       npm run db:init -- --no-demo  (เฉพาะ schema + seed ตามไฟล์ SQL)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database');
const CLIENT = (process.env.DB_CLIENT || 'mysql').toLowerCase();
const withDemo = !process.argv.includes('--no-demo');
const hasCode = (lines) => lines.some((l) => l.trim() && !l.trim().startsWith('--'));

// MySQL: แยกคำสั่งโดยรองรับ DELIMITER แบบเดียวกับ mysql client / phpMyAdmin
function splitMysql(text) {
  const statements = [];
  let delimiter = ';';
  let buf = [];
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

// Oracle: แบบ SQL*Plus / SQL Developer — คำสั่งทั่วไปจบด้วย ; และ PL/SQL จบด้วยบรรทัด /
function splitOracle(text) {
  const statements = [];
  let buf = [];
  let plsql = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!hasCode(buf)) {
      if (!t || t.startsWith('--')) continue;
      plsql = /^(CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER|PACKAGE|TYPE)\b|BEGIN\b|DECLARE\b)/i.test(t);
    }
    if (plsql) {
      if (t === '/') { statements.push(buf.join('\n')); buf = []; plsql = false; } else buf.push(line);
      continue;
    }
    buf.push(line);
    if (!t.startsWith('--') && t.endsWith(';')) {
      statements.push(buf.join('\n').trim().replace(/;$/, ''));
      buf = [];
    }
  }
  if (hasCode(buf)) statements.push(buf.join('\n'));
  return statements;
}

async function runFile(exec, file, split) {
  const statements = split(fs.readFileSync(path.join(DIR, file), 'utf8'));
  for (const sql of statements) {
    try {
      await exec(sql);
    } catch (err) {
      console.error(`\n✗ ${file} ผิดพลาดที่คำสั่ง:\n${sql.slice(0, 300)}\n→ ${err.message}`);
      throw err;
    }
  }
  console.log(`✓ ${file} (${statements.length} คำสั่ง)`);
}

async function initMysql() {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  });
  const [[ver]] = await conn.query('SELECT VERSION() AS v');
  console.log(`เชื่อมต่อ MySQL/MariaDB ${ver.v}`);
  const exec = (sql) => conn.query(sql);
  await runFile(exec, 'mut_shuttle.sql', splitMysql);
  if (withDemo) await runFile(exec, 'demo_data.sql', splitMysql);
  await conn.end();
}

async function initOracle() {
  const oracledb = require('oracledb');
  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: `${process.env.DB_HOST}:${process.env.DB_PORT || 1521}/${process.env.DB_SERVICE}`,
  });
  console.log(`เชื่อมต่อ Oracle ${conn.oracleServerVersionString} เป็นผู้ใช้ ${process.env.DB_USER}`);
  const exec = async (sql) => {
    await conn.execute(sql);
    // CREATE ... ที่คอมไพล์ไม่ผ่าน Oracle ไม่ throw — ตรวจจาก user_errors แทน
    const m = sql.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER)\s+(\w+)/i);
    if (m) {
      const errs = await conn.execute(
        'SELECT line, position, text FROM user_errors WHERE name = :n ORDER BY sequence', [m[2].toUpperCase()],
      );
      if (errs.rows.length) throw new Error(errs.rows.map((r) => `line ${r[0]}:${r[1]} ${r[2]}`).join('\n'));
    }
  };
  await runFile(exec, 'mut_shuttle_oracle.sql', splitOracle);
  if (withDemo) await runFile(exec, 'demo_data_oracle.sql', splitOracle);
  await conn.close();
}

(CLIENT === 'oracle' ? initOracle() : initMysql())
  .then(() => console.log('เสร็จแล้ว — รัน npm start แล้วเปิด http://localhost:' + (process.env.PORT || 3000)))
  .catch((err) => {
    if (err.code === 'ECONNREFUSED') console.error('เชื่อมต่อฐานข้อมูลไม่ได้ — ตรวจสอบว่าเปิดฐานข้อมูลแล้ว และค่าใน .env ถูกต้อง');
    else console.error(err.message);
    process.exit(1);
  });
