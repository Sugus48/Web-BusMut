# Web-BusMut

ระบบจองรถรับส่งและบริหารการเดินรถ (MUT Shuttle Bus System) — Node.js + Express + EJS + MySQL/MariaDB

## ติดตั้งและรัน

1. ติดตั้ง [Node.js](https://nodejs.org) 18+ และ [XAMPP](https://www.apachefriends.org) (หรือ MySQL 8)
2. เปิด **XAMPP Control Panel** → กด Start ที่ **MySQL**
3. ในโฟลเดอร์โปรเจกต์:
   ```bash
   npm install
   copy .env.example .env      # macOS/Linux: cp .env.example .env
   npm run db:init             # สร้างฐานข้อมูล mut_shuttle + ข้อมูลตัวอย่าง
   npm start
   ```
4. เปิด http://localhost:3000

> ถ้าใช้ phpMyAdmin แทน `npm run db:init`: import `database/mut_shuttle.sql` แล้วตามด้วย `database/demo_data.sql`

## บัญชีทดลอง (password = `1234`)

| username | บทบาท | หน้าแรก |
|---|---|---|
| `somchai` | Admin (P01) — เข้าหลังบ้านได้ทุกหน้าจอ | หลังบ้าน |
| `somying` | พนักงาน (P02) — คนขับ + ดูหน้าจัดการรถแบบอ่านอย่างเดียว | งานคนขับ |
| `somsak` | พนักงาน (P02) — คนขับ | งานคนขับ |
| `manee` | ผู้ใช้บริการทั่วไป (ไม่ใช่พนักงาน) | จองรถ |

## โครงสร้าง

```text
database/          mut_shuttle.sql (schema + trigger + procedure + seed), demo_data.sql
scripts/           db-init.js (รัน SQL รองรับ DELIMITER), check-views.js
src/app.js         Express app
src/db.js          MySQL pool + แปลง error เป็นข้อความไทย
src/middleware/    auth.js — Login, สิทธิ์ตาม ตำแหน่ง × หน้าจอ
src/routes/        auth, user, driver, admin/*
views/             EJS (layouts: auth / user / driver / admin)
public/            CSS / JS
```

## สิทธิ์การใช้งาน

เมนูและปุ่ม เพิ่ม/แก้ไข/ลบ แสดงตามตาราง `permissions` ของตำแหน่งผู้ใช้ (มีแถว = เข้าถึงได้)
หน้าจอในระบบผูกกับรหัสหน้าจอ SC01–SC12 ดู `src/middleware/auth.js`

## Scripts

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm start` | รันเว็บ |
| `npm run dev` | รันแบบ reload อัตโนมัติเมื่อแก้โค้ด |
| `npm run db:init` | ลบและสร้างฐานข้อมูลใหม่ + ข้อมูลตัวอย่าง (`-- --no-demo` = ไม่ใส่ demo) |
| `npm run check` | ตรวจ syntax ของ view ทั้งหมด |
