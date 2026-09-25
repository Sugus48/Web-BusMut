-- =====================================================================
--  ข้อมูลตัวอย่างเพิ่มเติมสำหรับทดลองใช้งาน (รันหลัง mut_shuttle.sql)
--  - รอบรถ "วันนี้" และ "พรุ่งนี้" (อิง CURDATE() จึงค้นหาและจองได้ทุกวันที่รัน)
--  - รอบที่เสร็จสิ้นแล้วในอดีต + การจอง เพื่อให้รายงานมีข้อมูล
--  ทุกบัญชี password = 1234
-- =====================================================================
USE mut_shuttle;

INSERT INTO departments VALUES ('D003', 'ฝ่ายวิชาการ');

INSERT INTO users VALUES
  ('U003', 'สมศักดิ์', 'somsak@mail.com', 'somsak', SHA2('1234', 256), 'D002'),
  ('U004', 'มานี',    'manee@mail.com',  'manee',  SHA2('1234', 256), 'D003');

-- สมศักดิ์ = คนขับคนที่ 2 / มานี = ผู้ใช้บริการทั่วไป (ไม่ใช่พนักงาน)
INSERT INTO employees VALUES ('U003', '0833333333', 'P02');

INSERT INTO vehicles VALUES ('V003', 'สย 2591', 'พร้อมใช้งาน', 'T01');

-- รอบวันนี้ (เวลารวมเส้นทาง 30 นาที — ไม่มีรถ/คนขับชนเวลา)
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES
  ('TR003', CURDATE(), '07:00:00', 'เปิด', 'V001', 'R001', 'U002'),
  ('TR004', CURDATE(), '08:30:00', 'เปิด', 'V003', 'R001', 'U003'),
  ('TR005', CURDATE(), '09:30:00', 'เปิด', 'V001', 'R001', 'U002'),
  ('TR006', CURDATE(), '11:00:00', 'เปิด', 'V002', 'R001', 'U003'),
  ('TR007', CURDATE(), '13:30:00', 'เปิด', 'V001', 'R001', 'U002'),
  ('TR008', CURDATE(), '15:00:00', 'เปิด', 'V003', 'R001', 'U003'),
  ('TR009', CURDATE(), '16:30:00', 'เปิด', 'V002', 'R001', 'U002'),
  ('TR010', CURDATE(), '17:30:00', 'เปิด', 'V001', 'R001', 'U003'),
  ('TR011', CURDATE(), '19:00:00', 'เปิด', 'V003', 'R001', 'U002');

-- รอบพรุ่งนี้
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES
  ('TR012', CURDATE() + INTERVAL 1 DAY, '07:00:00', 'เปิด', 'V001', 'R001', 'U002'),
  ('TR013', CURDATE() + INTERVAL 1 DAY, '08:30:00', 'เปิด', 'V003', 'R001', 'U003'),
  ('TR014', CURDATE() + INTERVAL 1 DAY, '09:30:00', 'เปิด', 'V001', 'R001', 'U002'),
  ('TR015', CURDATE() + INTERVAL 1 DAY, '11:00:00', 'เปิด', 'V002', 'R001', 'U003'),
  ('TR016', CURDATE() + INTERVAL 1 DAY, '13:30:00', 'เปิด', 'V001', 'R001', 'U002'),
  ('TR017', CURDATE() + INTERVAL 1 DAY, '15:00:00', 'เปิด', 'V003', 'R001', 'U003'),
  ('TR018', CURDATE() + INTERVAL 1 DAY, '16:30:00', 'เปิด', 'V002', 'R001', 'U002'),
  ('TR019', CURDATE() + INTERVAL 1 DAY, '17:30:00', 'เปิด', 'V001', 'R001', 'U003'),
  ('TR020', CURDATE() + INTERVAL 1 DAY, '19:00:00', 'เปิด', 'V003', 'R001', 'U002');

-- รอบในอดีต (เสร็จสิ้นแล้ว)
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES
  ('TR021', CURDATE() - INTERVAL 3 DAY, '08:00:00', 'เสร็จสิ้น', 'V001', 'R001', 'U002'),
  ('TR022', CURDATE() - INTERVAL 3 DAY, '17:30:00', 'เสร็จสิ้น', 'V003', 'R001', 'U003'),
  ('TR023', CURDATE() - INTERVAL 2 DAY, '09:30:00', 'เสร็จสิ้น', 'V002', 'R001', 'U003'),
  ('TR024', CURDATE() - INTERVAL 1 DAY, '18:00:00', 'เสร็จสิ้น', 'V001', 'R001', 'U002');

INSERT INTO bookings VALUES
  ('B003', NOW() - INTERVAL 5 DAY, 'U001'),
  ('B004', NOW() - INTERVAL 5 DAY, 'U004'),
  ('B005', NOW() - INTERVAL 4 DAY, 'U004'),
  ('B006', NOW() - INTERVAL 3 DAY, 'U001'),
  ('B007', NOW() - INTERVAL 2 DAY, 'U004'),
  ('B008', NOW() - INTERVAL 1 HOUR, 'U004'),
  ('B009', NOW() - INTERVAL 30 MINUTE, 'U001');

INSERT INTO booking_items
  (booking_item_id, qr_code, status, seats, checkin_at, booking_id, trip_id, board_stop_id, alight_stop_id) VALUES
  ('BD003', 'QR-BD003-DEMO0003', 'ยืนยัน',  2, TIMESTAMP(CURDATE() - INTERVAL 3 DAY, '08:05:00'), 'B003', 'TR021', 'S002', 'S004'),
  ('BD004', 'QR-BD004-DEMO0004', 'No Show', 1, NULL,                                             'B004', 'TR021', 'S001', 'S003'),
  ('BD005', 'QR-BD005-DEMO0005', 'ยืนยัน',  1, TIMESTAMP(CURDATE() - INTERVAL 3 DAY, '17:30:00'), 'B005', 'TR022', 'S001', 'S004'),
  ('BD006', 'QR-BD006-DEMO0006', 'ยืนยัน',  3, TIMESTAMP(CURDATE() - INTERVAL 2 DAY, '09:38:00'), 'B006', 'TR023', 'S003', 'S001'),
  ('BD007', 'QR-BD007-DEMO0007', 'ยกเลิก',  1, NULL,                                             'B007', 'TR024', 'S002', 'S001'),
  ('BD008', 'QR-BD008-DEMO0008', 'ยืนยัน',  2, NULL,                                             'B008', 'TR011', 'S002', 'S004'),
  ('BD009', 'QR-BD009-DEMO0009', 'ยืนยัน',  1, NULL,                                             'B009', 'TR014', 'S001', 'S004');
