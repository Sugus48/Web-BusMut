const express = require('express');
const db = require('../db');
const { verifyPassword, hashPassword, needsRehash } = require('../lib/password');
const { loadPermissions, landingFor } = require('../middleware/auth');

const router = express.Router();

const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : null);

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(landingFor(req.perms));
  const info = req.query.out ? 'ออกจากระบบเรียบร้อยแล้ว' : null;
  res.page('auth/login', { title: 'เข้าสู่ระบบ', next: req.query.next || '', username: '', errors: {}, info });
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const next = req.body.next || '';
  const errors = {};
  if (!username) errors.username = 'กรุณากรอก username';
  if (!password) errors.password = 'กรุณากรอก password';

  let user = null;
  if (!Object.keys(errors).length) {
    user = await db.one('SELECT user_id, name, username, password_hash FROM users WHERE username = ?', [username]);
    if (!user) errors.username = 'ไม่พบ username นี้ในระบบ';
    else if (!(await verifyPassword(password, user.password_hash))) errors.password = 'password ไม่ถูกต้อง';
  }
  if (Object.keys(errors).length) {
    return res.status(401).page('auth/login', { title: 'เข้าสู่ระบบ', next, username, errors });
  }

  // อัปเกรด hash เดิม (SHA2) เป็น bcrypt เมื่อ login สำเร็จ
  if (needsRehash(user.password_hash)) {
    await db.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await hashPassword(password), user.user_id]);
  }

  await new Promise((ok, fail) => req.session.regenerate((e) => (e ? fail(e) : ok())));
  req.session.user = { user_id: user.user_id, name: user.name, username: user.username };
  await new Promise((ok, fail) => req.session.save((e) => (e ? fail(e) : ok())));
  res.cookie('mut_seen', '1', { maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

  const emp = await db.one('SELECT position_id FROM employees WHERE user_id = ?', [user.user_id]);
  const perms = await loadPermissions(emp && emp.position_id);
  res.redirect(safeNext(next) || landingFor(perms));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('mut_sid');
    res.clearCookie('mut_seen');
    res.redirect('/login?out=1');
  });
});

module.exports = router;
