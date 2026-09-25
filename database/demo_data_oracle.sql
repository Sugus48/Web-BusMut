-- =====================================================================
--  ข้อมูลตัวอย่างเพิ่มเติม (Oracle) — รันหลัง mut_shuttle_oracle.sql
--  - รอบรถ "วันนี้" และ "พรุ่งนี้" (อิง SYSDATE จึงค้นหาและจองได้ทุกวันที่รัน)
--  - รอบที่เสร็จสิ้นแล้วในอดีต + การจอง เพื่อให้รายงานมีข้อมูล
--  ทุกบัญชี password = 1234
-- =====================================================================

INSERT INTO departments VALUES ('D003', 'ฝ่ายวิชาการ');

INSERT INTO users VALUES ('U003', 'สมศักดิ์', 'somsak@mail.com', 'somsak', LOWER(RAWTOHEX(STANDARD_HASH('1234', 'SHA256'))), 'D002');
INSERT INTO users VALUES ('U004', 'มานี', 'manee@mail.com', 'manee', LOWER(RAWTOHEX(STANDARD_HASH('1234', 'SHA256'))), 'D003');

-- สมศักดิ์ = คนขับคนที่ 2 / มานี = ผู้ใช้บริการทั่วไป (ไม่ใช่พนักงาน)
INSERT INTO employees VALUES ('U003', '0833333333', 'P02');

INSERT INTO vehicles VALUES ('V003', 'สย 2591', 'พร้อมใช้งาน', 'T01');

-- รอบวันนี้ (เวลารวมเส้นทาง 30 นาที — ไม่มีรถ/คนขับชนเวลา)
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR003', TRUNC(SYSDATE), '07:00:00', 'เปิด', 'V001', 'R001', 'U002');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR004', TRUNC(SYSDATE), '08:30:00', 'เปิด', 'V003', 'R001', 'U003');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR005', TRUNC(SYSDATE), '09:30:00', 'เปิด', 'V001', 'R001', 'U002');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR006', TRUNC(SYSDATE), '11:00:00', 'เปิด', 'V002', 'R001', 'U003');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR007', TRUNC(SYSDATE), '13:30:00', 'เปิด', 'V001', 'R001', 'U002');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR008', TRUNC(SYSDATE), '15:00:00', 'เปิด', 'V003', 'R001', 'U003');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR009', TRUNC(SYSDATE), '16:30:00', 'เปิด', 'V002', 'R001', 'U002');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR010', TRUNC(SYSDATE), '17:30:00', 'เปิด', 'V001', 'R001', 'U003');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR011', TRUNC(SYSDATE), '19:00:00', 'เปิด', 'V003', 'R001', 'U002');

-- รอบพรุ่งนี้
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR012', TRUNC(SYSDATE) + 1, '07:00:00', 'เปิด', 'V001', 'R001', 'U002');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR013', TRUNC(SYSDATE) + 1, '08:30:00', 'เปิด', 'V003', 'R001', 'U003');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR014', TRUNC(SYSDATE) + 1, '09:30:00', 'เปิด', 'V001', 'R001', 'U002');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR015', TRUNC(SYSDATE) + 1, '11:00:00', 'เปิด', 'V002', 'R001', 'U003');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR016', TRUNC(SYSDATE) + 1, '13:30:00', 'เปิด', 'V001', 'R001', 'U002');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR017', TRUNC(SYSDATE) + 1, '15:00:00', 'เปิด', 'V003', 'R001', 'U003');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR018', TRUNC(SYSDATE) + 1, '16:30:00', 'เปิด', 'V002', 'R001', 'U002');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR019', TRUNC(SYSDATE) + 1, '17:30:00', 'เปิด', 'V001', 'R001', 'U003');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR020', TRUNC(SYSDATE) + 1, '19:00:00', 'เปิด', 'V003', 'R001', 'U002');

-- รอบในอดีต (เสร็จสิ้นแล้ว)
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR021', TRUNC(SYSDATE) - 3, '08:00:00', 'เสร็จสิ้น', 'V001', 'R001', 'U002');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR022', TRUNC(SYSDATE) - 3, '17:30:00', 'เสร็จสิ้น', 'V003', 'R001', 'U003');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR023', TRUNC(SYSDATE) - 2, '09:30:00', 'เสร็จสิ้น', 'V002', 'R001', 'U003');
INSERT INTO trips (trip_id, trip_date, depart_time, status, vehicle_id, route_id, driver_id) VALUES ('TR024', TRUNC(SYSDATE) - 1, '18:00:00', 'เสร็จสิ้น', 'V001', 'R001', 'U002');

INSERT INTO bookings VALUES ('B003', SYSDATE - 5, 'U001');
INSERT INTO bookings VALUES ('B004', SYSDATE - 5, 'U004');
INSERT INTO bookings VALUES ('B005', SYSDATE - 4, 'U004');
INSERT INTO bookings VALUES ('B006', SYSDATE - 3, 'U001');
INSERT INTO bookings VALUES ('B007', SYSDATE - 2, 'U004');
INSERT INTO bookings VALUES ('B008', SYSDATE - 1 / 24, 'U004');
INSERT INTO bookings VALUES ('B009', SYSDATE - 30 / 1440, 'U001');

INSERT INTO booking_items (booking_item_id, qr_code, status, seats, checkin_at, booking_id, trip_id, board_stop_id, alight_stop_id)
VALUES ('BD003', 'QR-BD003-DEMO0003', 'ยืนยัน', 2, mut_ts(TRUNC(SYSDATE) - 3, '08:05:00'), 'B003', 'TR021', 'S002', 'S004');
INSERT INTO booking_items (booking_item_id, qr_code, status, seats, checkin_at, booking_id, trip_id, board_stop_id, alight_stop_id)
VALUES ('BD004', 'QR-BD004-DEMO0004', 'No Show', 1, NULL, 'B004', 'TR021', 'S001', 'S003');
INSERT INTO booking_items (booking_item_id, qr_code, status, seats, checkin_at, booking_id, trip_id, board_stop_id, alight_stop_id)
VALUES ('BD005', 'QR-BD005-DEMO0005', 'ยืนยัน', 1, mut_ts(TRUNC(SYSDATE) - 3, '17:30:00'), 'B005', 'TR022', 'S001', 'S004');
INSERT INTO booking_items (booking_item_id, qr_code, status, seats, checkin_at, booking_id, trip_id, board_stop_id, alight_stop_id)
VALUES ('BD006', 'QR-BD006-DEMO0006', 'ยืนยัน', 3, mut_ts(TRUNC(SYSDATE) - 2, '09:38:00'), 'B006', 'TR023', 'S003', 'S001');
INSERT INTO booking_items (booking_item_id, qr_code, status, seats, checkin_at, booking_id, trip_id, board_stop_id, alight_stop_id)
VALUES ('BD007', 'QR-BD007-DEMO0007', 'ยกเลิก', 1, NULL, 'B007', 'TR024', 'S002', 'S001');
INSERT INTO booking_items (booking_item_id, qr_code, status, seats, checkin_at, booking_id, trip_id, board_stop_id, alight_stop_id)
VALUES ('BD008', 'QR-BD008-DEMO0008', 'ยืนยัน', 2, NULL, 'B008', 'TR011', 'S002', 'S004');
INSERT INTO booking_items (booking_item_id, qr_code, status, seats, checkin_at, booking_id, trip_id, board_stop_id, alight_stop_id)
VALUES ('BD009', 'QR-BD009-DEMO0009', 'ยืนยัน', 1, NULL, 'B009', 'TR014', 'S001', 'S004');

COMMIT;
