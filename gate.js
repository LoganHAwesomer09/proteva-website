(function () {
  var GATE_KEY = 'proteva_gate_ok';
  if (sessionStorage.getItem(GATE_KEY) === '1') return;

  // Change this password and share only with family (Kellen, dad).
  var FAMILY_PASSWORD = 'protect2026';

  var style = document.createElement('style');
  style.textContent =
    '#proteva-gate{position:fixed;inset:0;background:#F4FBF8;display:flex;align-items:center;justify-content:center;padding:1.5rem;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '#proteva-gate .card{background:#fff;border:1px solid #e8e8e8;border-radius:18px;padding:2rem;width:100%;max-width:380px;box-shadow:0 12px 40px rgba(0,0,0,.06)}' +
    '#proteva-gate .logo{font-size:22px;font-weight:700;margin-bottom:.5rem}#proteva-gate .logo span{color:#1D9E75}' +
    '#proteva-gate p{font-size:14px;color:#666;line-height:1.6;margin:0 0 1.25rem}' +
    '#proteva-gate input{width:100%;padding:13px 15px;border:1.5px solid #ddd;border-radius:10px;font-size:15px;margin-bottom:1rem;box-sizing:border-box}' +
    '#proteva-gate input:focus{outline:none;border-color:#1D9E75}' +
    '#proteva-gate button{width:100%;background:#1D9E75;color:#fff;border:none;padding:14px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}' +
    '#proteva-gate button:hover{background:#0F6E56}' +
    '#proteva-gate .err{display:none;background:#FCEBEB;color:#A32D2D;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:1rem}';
  document.head.appendChild(style);

  var wrap = document.createElement('div');
  wrap.id = 'proteva-gate';
  wrap.innerHTML =
    '<div class="card">' +
    '<div class="logo">Pro<span>teva</span></div>' +
    '<p>Private preview — family only. Enter the password to continue.</p>' +
    '<div class="err" id="proteva-gate-err">Wrong password. Try again.</div>' +
    '<input type="password" id="proteva-gate-pw" placeholder="Password" autocomplete="current-password" />' +
    '<button type="button" id="proteva-gate-btn">Continue</button>' +
    '</div>';
  document.body.appendChild(wrap);

  function hideMain() {
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el.id !== 'proteva-gate') el.style.display = 'none';
    });
  }
  function showMain() {
    var gate = document.getElementById('proteva-gate');
    if (gate) gate.remove();
    Array.prototype.forEach.call(document.body.children, function (el) {
      el.style.display = '';
    });
  }
  hideMain();

  function tryUnlock() {
    var pw = document.getElementById('proteva-gate-pw').value;
    if (pw === FAMILY_PASSWORD) {
      sessionStorage.setItem(GATE_KEY, '1');
      showMain();
      return;
    }
    document.getElementById('proteva-gate-err').style.display = 'block';
  }

  document.getElementById('proteva-gate-btn').onclick = tryUnlock;
  document.getElementById('proteva-gate-pw').onkeydown = function (e) {
    if (e.key === 'Enter') tryUnlock();
  };
})();
