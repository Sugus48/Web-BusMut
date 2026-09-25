const db = require('../db');

// หน้าจอ (screens.screen_id) ที่ใช้ควบคุมแต่ละส่วนของระบบ
const SCREEN = {
  VEHICLES: 'SC01',
  BOOKINGS: 'SC02',
  VEHICLE_TYPES: 'SC03',
  STOPS: 'SC04',
  ROUTES: 'SC05',
  TRIPS: 'SC06',
  USERS: 'SC07',
  DEPARTMENTS: 'SC08',
  POSITIONS: 'SC09',
  PERMISSIONS: 'SC10',
  REPORTS: 'SC11',
  DRIVER: 'SC12',
};

// หน้าจอหลังบ้าน (ใครมีอย่างน้อย 1 หน้าจอ = เข้า Dashboard ได้)
const ADMIN_SCREENS = ['SC01', 'SC02', 'SC03', 'SC04', 'SC05', 'SC06', 'SC07', 'SC08', 'SC09', 'SC10', 'SC11'];

const ADMIN_MENU = [
  { group: 'ข้อมูลหลัก', items: [
    { label: 'ผู้ใช้งาน / พนักงาน', href: '/admin/users', screen: SCREEN.USERS },
    { label: 'แผนก', href: '/admin/departments', screen: SCREEN.DEPARTMENTS },
    { label: 'ตำแหน่ง', href: '/admin/positions', screen: SCREEN.POSITIONS },
  ] },
  { group: 'สิทธิ์', items: [
    { label: 'หน้าจอ', href: '/admin/screens', screen: SCREEN.PERMISSIONS },
    { label: 'สิทธิ์ตามตำแหน่ง', href: '/admin/permissions', screen: SCREEN.PERMISSIONS },
  ] },
  { group: 'การเดินรถ', items: [
    { label: 'ประเภทรถ', href: '/admin/vehicle-types', screen: SCREEN.VEHICLE_TYPES },
    { label: 'รถ', href: '/admin/vehicles', screen: SCREEN.VEHICLES },
    { label: 'จุดจอด', href: '/admin/stops', screen: SCREEN.STOPS },
    { label: 'เส้นทาง', href: '/admin/routes', screen: SCREEN.ROUTES },
    { label: 'รอบการเดินรถ', href: '/admin/trips', screen: SCREEN.TRIPS },
  ] },
  { group: 'การจอง', items: [
    { label: 'การจอง', href: '/admin/bookings', screen: SCREEN.BOOKINGS },
  ] },
  { group: 'รายงาน', items: [
    { label: 'รายงาน', href: '/admin/reports', screen: SCREEN.REPORTS },
  ] },
];

// โหลดสิทธิ์ของตำแหน่งจากฐานข้อมูลทุก request เพื่อให้การแก้สิทธิ์มีผลทันที
async function loadPermissions(positionId) {
  if (!positionId) return {};
  const rows = await db.query(
    'SELECT screen_id, can_add, can_edit, can_delete FROM permissions WHERE position_id = ?',
    [positionId],
  );
  const perms = {};
  for (const r of rows) {
    perms[r.screen_id] = { add: !!r.can_add, edit: !!r.can_edit, delete: !!r.can_delete };
  }
  return perms;
}

// ตั้งค่า res.locals สำหรับทุกหน้า
async function attachUser(req, res, next) {
  const user = req.session.user || null;
  let perms = {};
  if (user) {
    const emp = await db.one('SELECT position_id FROM employees WHERE user_id = ?', [user.user_id]);
    user.position_id = emp ? emp.position_id : null;
    perms = await loadPermissions(user.position_id);
  }
  req.perms = perms;
  res.locals.user = user;
  res.locals.perms = perms;
  res.locals.hasScreen = (s) => !!perms[s];
  res.locals.can = (s, action) => !!(perms[s] && perms[s][action]);
  res.locals.isDriver = !!perms[SCREEN.DRIVER];
  res.locals.hasAdmin = ADMIN_SCREENS.some((s) => perms[s]);
  res.locals.adminMenu = ADMIN_MENU;
  res.locals.SCREEN = SCREEN;
  next();
}

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  const expired = /(?:^|;\s*)mut_seen=1/.test(req.headers.cookie || '');
  req.flash('error', expired ? 'Session หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : 'กรุณาเข้าสู่ระบบก่อนใช้งาน');
  const nextUrl = req.method === 'GET' ? req.originalUrl : '/';
  return res.redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
}

function denied(res) {
  return res.status(403).page('auth/denied', { title: 'ไม่มีสิทธิ์เข้าถึง' });
}

// ต้องมีแถวใน สิทธิ์ ของหน้าจอนี้ (= เข้าถึง/ดูได้)
function requireScreen(screen) {
  return (req, res, next) => (req.perms[screen] ? next() : denied(res));
}

// ต้องมีสิทธิ์ เพิ่ม/แก้ไข/ลบ ของหน้าจอนี้
function requirePerm(screen, action) {
  return (req, res, next) => (req.perms[screen] && req.perms[screen][action] ? next() : denied(res));
}

function requireAnyAdmin(req, res, next) {
  return ADMIN_SCREENS.some((s) => req.perms[s]) ? next() : denied(res);
}

// หน้าแรกหลัง Login ตามสิทธิ์
function landingFor(perms) {
  if (perms[SCREEN.DRIVER]) return '/driver';
  if (ADMIN_SCREENS.some((s) => perms[s])) return '/admin';
  return '/';
}

module.exports = {
  SCREEN, ADMIN_SCREENS, ADMIN_MENU,
  loadPermissions, attachUser, requireLogin, requireScreen, requirePerm, requireAnyAdmin, landingFor, denied,
};
