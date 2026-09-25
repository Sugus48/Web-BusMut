// หน้าจัดการข้อมูลหลักแบบมาตรฐาน: Search/Filter + Table + เพิ่ม/แก้ไข/ลบ (ตามสิทธิ์) + Confirmation
const express = require('express');
const db = require('../../db');
const { requireScreen, requirePerm } = require('../../middleware/auth');

const resolve = async (opts) => (typeof opts === 'function' ? opts() : opts || []);

/**
 * cfg = {
 *   screen, title, table, pk, prefix, pad,
 *   listSql,            SELECT ที่มีคอลัมน์ทั้งหมดสำหรับตาราง (ห่อด้วย subquery x)
 *   searchCols,         คอลัมน์ที่ค้นหาด้วยช่อง q
 *   filters,            [{ name, label, options }] กรองด้วยค่าเท่ากับ
 *   columns,            [{ key, label, badge?, fmt?(row), align? }]
 *   fields,             [{ name, label, type: text|number|textarea|select, required?, max?, min?, options?, hint? }]
 *   unique,             { field: ข้อความ } ใช้เมื่อชน UNIQUE (errno 1062)
 *   rowLinks,           [{ label, href(row), screen? }]
 *   beforeDelete(id),   คืนข้อความถ้าห้ามลบ
 *   deleteWarning,      ข้อความเพิ่มเติมใน Confirmation
 *   afterSave(),        เรียกหลังบันทึก
 *   note,               ข้อความใต้หัวข้อ
 * }
 */
function crud(cfg) {
  const router = express.Router();
  router.use(requireScreen(cfg.screen));

  async function formFields() {
    return Promise.all(cfg.fields.map(async (f) => ({ ...f, options: f.type === 'select' ? await resolve(f.options) : null })));
  }

  async function renderForm(req, res, { values, errors = {}, isNew, id }) {
    res.status(Object.keys(errors).length ? 422 : 200).page('admin/crud-form', {
      title: `${isNew ? 'เพิ่ม' : 'แก้ไข'}${cfg.title}`, cfg, base: req.baseUrl,
      fields: await formFields(), values, errors, isNew, id,
    });
  }

  async function validate(body) {
    const values = {};
    const errors = {};
    for (const f of await formFields()) {
      let v = body[f.name];
      v = v === undefined || v === null ? '' : String(v).trim();
      if (f.required && v === '') { errors[f.name] = `กรุณากรอก${f.label}`; continue; }
      if (v === '') { values[f.name] = null; continue; }
      if (f.max && v.length > f.max) errors[f.name] = `${f.label}ยาวได้ไม่เกิน ${f.max} ตัวอักษร`;
      if (f.type === 'number') {
        const n = Number(v);
        if (!Number.isInteger(n)) errors[f.name] = `${f.label}ต้องเป็นจำนวนเต็ม`;
        else if (f.min !== undefined && n < f.min) errors[f.name] = `${f.label}ต้องไม่น้อยกว่า ${f.min}`;
        v = n;
      }
      if (f.type === 'select' && !f.options.some((o) => String(o.value) === v)) errors[f.name] = `กรุณาเลือก${f.label}`;
      values[f.name] = v;
    }
    return { values, errors };
  }

  // ชน UNIQUE → แสดงที่ field
  function uniqueError(err, errors) {
    if (err.errno !== 1062 || !cfg.unique) return false;
    const [field, msg] = Object.entries(cfg.unique)[0];
    errors[field] = msg;
    return true;
  }

  router.get('/', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const where = [];
    const params = [];
    if (q && cfg.searchCols) {
      where.push(`(${cfg.searchCols.map((c) => `x.${c} LIKE ?`).join(' OR ')})`);
      cfg.searchCols.forEach(() => params.push(`%${q}%`));
    }
    const filters = await Promise.all((cfg.filters || []).map(async (f) => ({ ...f, options: await resolve(f.options) })));
    for (const f of filters) {
      if (req.query[f.name]) { where.push(`x.${f.name} = ?`); params.push(req.query[f.name]); }
    }
    const rows = await db.query(
      `SELECT * FROM (${cfg.listSql}) x ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY x.${cfg.pk}`,
      params,
    );
    res.page('admin/crud-list', { title: cfg.title, cfg, base: req.baseUrl, rows, q, filters });
  });

  router.get('/new', requirePerm(cfg.screen, 'add'), (req, res) => renderForm(req, res, { values: {}, isNew: true }));

  router.post('/', requirePerm(cfg.screen, 'add'), async (req, res) => {
    const { values, errors } = await validate(req.body);
    if (!Object.keys(errors).length) {
      try {
        const id = await db.nextId(cfg.table, cfg.pk, cfg.prefix, cfg.pad);
        await db.insert(cfg.table, { [cfg.pk]: id, ...values });
        if (cfg.afterSave) await cfg.afterSave();
        req.flash('success', `เพิ่ม${cfg.title} ${id} เรียบร้อยแล้ว`);
        return res.redirect(req.baseUrl);
      } catch (err) {
        if (!uniqueError(err, errors)) { if (!err.errno) throw err; errors._form = db.errorMessage(err); }
      }
    }
    renderForm(req, res, { values, errors, isNew: true });
  });

  router.get('/:id/edit', requirePerm(cfg.screen, 'edit'), async (req, res, next) => {
    const row = await db.one(`SELECT * FROM ${cfg.table} WHERE ${cfg.pk} = ?`, [req.params.id]);
    if (!row) return next();
    renderForm(req, res, { values: row, isNew: false, id: req.params.id });
  });

  router.post('/:id', requirePerm(cfg.screen, 'edit'), async (req, res, next) => {
    const exists = await db.one(`SELECT 1 AS ok FROM ${cfg.table} WHERE ${cfg.pk} = ?`, [req.params.id]);
    if (!exists) return next();
    const { values, errors } = await validate(req.body);
    if (!Object.keys(errors).length) {
      try {
        await db.update(cfg.table, values, { [cfg.pk]: req.params.id });
        if (cfg.afterSave) await cfg.afterSave();
        req.flash('success', `บันทึก${cfg.title} ${req.params.id} เรียบร้อยแล้ว`);
        return res.redirect(req.baseUrl);
      } catch (err) {
        if (!uniqueError(err, errors)) { if (!err.errno) throw err; errors._form = db.errorMessage(err); }
      }
    }
    renderForm(req, res, { values, errors, isNew: false, id: req.params.id });
  });

  router.post('/:id/delete', requirePerm(cfg.screen, 'delete'), async (req, res) => {
    const id = req.params.id;
    const reason = cfg.beforeDelete ? await cfg.beforeDelete(id) : null;
    if (reason) {
      req.flash('error', reason);
      return res.redirect(req.baseUrl);
    }
    try {
      await db.query(`DELETE FROM ${cfg.table} WHERE ${cfg.pk} = ?`, [id]);
      req.flash('success', `ลบ${cfg.title} ${id} เรียบร้อยแล้ว`);
    } catch (err) {
      if (!err.errno) throw err;
      req.flash('error', db.errorMessage(err));
    }
    res.redirect(req.baseUrl);
  });

  return router;
}

module.exports = crud;
