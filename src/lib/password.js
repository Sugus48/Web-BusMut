const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// รองรับ 2 รูปแบบ: bcrypt (ที่แอปสร้าง) และ SHA2-256 hex (ข้อมูล seed ใน mut_shuttle.sql)
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  if (hash.startsWith('$2')) return bcrypt.compare(plain, hash);
  if (/^[0-9a-f]{64}$/i.test(hash)) {
    const digest = crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hash.toLowerCase()));
  }
  return false;
}

const hashPassword = (plain) => bcrypt.hash(plain, 10);
const needsRehash = (hash) => !String(hash).startsWith('$2');

module.exports = { verifyPassword, hashPassword, needsRehash };
