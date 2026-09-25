// Confirmation Modal สำหรับ form ที่มี data-confirm
// ใช้: <form method="post" data-confirm="ข้อความ" data-confirm-title="หัวข้อ" data-confirm-ok="ยืนยัน">
(function () {
  const dialog = document.getElementById('confirm-dialog');
  if (!dialog) return;
  const titleEl = dialog.querySelector('[data-title]');
  const msgEl = dialog.querySelector('[data-message]');
  const okBtn = dialog.querySelector('[data-ok]');
  let pending = null;

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.dataset.confirm || form.dataset.confirmed) return;
    e.preventDefault();
    pending = form;
    titleEl.textContent = form.dataset.confirmTitle || 'ยืนยันการทำรายการ';
    msgEl.textContent = form.dataset.confirm;
    okBtn.textContent = form.dataset.confirmOk || 'ยืนยัน';
    okBtn.className = 'btn ' + (form.dataset.confirmTone === 'primary' ? 'btn-primary' : 'btn-danger');
    dialog.showModal();
  });

  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'ok' && pending) {
      pending.dataset.confirmed = '1';
      if (pending.requestSubmit) pending.requestSubmit(); else pending.submit();
    }
    pending = null;
  });
})();

// ปุ่มเปิด/ปิด sidebar หลังบ้านบนจอเล็ก
(function () {
  const toggle = document.querySelector('.menu-toggle');
  if (!toggle) return;
  const root = document.querySelector('.admin');
  toggle.addEventListener('click', () => {
    const open = root.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
})();

// ปุ่มแสดง/ซ่อนรหัสผ่าน
document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.togglePassword);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'ซ่อน' : 'แสดง';
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
  });
});

// ปิดปุ่ม submit ระหว่างส่ง (Loading state)
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.confirm && !form.dataset.confirmed) return;
  const btn = form.querySelector('[data-loading]');
  if (btn) {
    setTimeout(() => { btn.disabled = true; btn.textContent = btn.dataset.loading; }, 0);
  }
});
