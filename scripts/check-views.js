// คอมไพล์ทุกไฟล์ .ejs เพื่อตรวจ syntax error (ไม่ต้องใช้ฐานข้อมูล)
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..', 'views');
let failed = 0;
let count = 0;

(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.ejs')) continue;
    count++;
    try {
      ejs.compile(fs.readFileSync(p, 'utf8'), { filename: p });
    } catch (e) {
      failed++;
      console.error(`✗ ${path.relative(root, p)}\n  ${e.message.split('\n').slice(-1)[0]}`);
    }
  }
})(root);

console.log(`${count - failed}/${count} views OK`);
process.exit(failed ? 1 : 0);
