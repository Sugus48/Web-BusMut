require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const session = require('express-session');
const helpers = require('./lib/helpers');
const db = require('./db');
const { attachUser } = require('./middleware/auth');

const app = express();
const ROOT = path.join(__dirname, '..');

app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
Object.assign(app.locals, helpers);

app.use('/static', express.static(path.join(ROOT, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  name: 'mut_sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 2 * 60 * 60 * 1000 }, // 2 ชั่วโมงนับจากใช้งานล่าสุด
}));

// flash message + res.page (render view ภายใน layout ตามโฟลเดอร์ของ view)
app.use((req, res, next) => {
  req.flash = (type, msg) => { req.session.flash = { type, msg }; };
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.page = (view, data = {}) => {
    const layout = data.layout || view.split('/')[0];
    res.render(view, data, (err, body) => {
      if (err) return next(err);
      res.render(`layouts/${layout}`, { ...data, body });
    });
  };
  next();
});

app.use(attachUser);

app.use(require('./routes/auth'));
app.use(require('./routes/user'));
app.use('/driver', require('./routes/driver'));
app.use('/admin', require('./routes/admin'));

// 404
app.use((req, res) => {
  res.status(404).page('auth/not-found', { title: 'ไม่พบหน้า' });
});

// Error
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const message = db.errorMessage(err);
  res.status(500);
  try {
    res.page('auth/error', { title: 'เกิดข้อผิดพลาด', message });
  } catch {
    res.send(message);
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`MUT Shuttle running at http://localhost:${port}`);
});
