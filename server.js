require("dotenv").config();
const express = require('express'),
  crypto = require('crypto'),
  QR = require('qrcode');
const chain = require('./blockchain');
const mailer = require('./mailer');
const db = require('./db');  // ← dual-mode DB (Turso cloud hoặc SQLite local)
const { normalizeAvatar, prepareAvatar } = require('./avatar');

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const SECRET = process.env.SECRET || 'avatix-dev-secret-doi-khi-deploy';
require('./chain-jobs')(db, chain);
const pinSecurity = require('./pin-security')(db, SECRET);
const FEE = 0.05, CAP = 1.1, METHODS = ['momo', 'bank', 'vnpay', 'vietqr'];

const E = (m, c = 400) => Object.assign(new Error(m), { c }),
  sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex'),
  hash = (p, s) => crypto.scryptSync(p, s, 32).toString('hex');
const cookies = r => Object.fromEntries((r.headers.cookie || '').split('; ').filter(Boolean).map(x => x.split('=')));
const int = (v, min, max, msg) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw E(msg); return n; };

const getDeviceType = req => {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (/mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
};

const auth = role => async (r, s, n) => {
  try {
    const raw = cookies(r).t || '';
    if (!raw) throw E('Chưa đăng nhập', 401);
    const parts = raw.split('.');

    let id, exp, dev, sid, sg;

    if (parts.length === 5) {
      // Phiên bảo mật kép (1 Mobile + 1 PC): id.exp.dev.sid.sg
      [id, exp, dev, sid, sg] = parts;
      const expectedSig = sign(`${id}.${exp}.${dev}.${sid}`).slice(0, 32);
      if (!sg || expectedSig !== sg || +exp < Date.now()) throw E('Phiên đăng nhập đã hết hạn', 401);

      const u = await db.get('SELECT * FROM users WHERE id=?', [id]);
      if (!u) throw E('Tài khoản không tồn tại', 401);
      if (u.status === 'locked') throw E('Tài khoản của bạn đã bị quản trị viên tạm khóa', 403);

      // Kiểm tra phiên đơn nhất theo loại thiết bị (Single Session per Device Type)
      const currentSid = dev === 'mobile' ? u.session_mobile : u.session_desktop;
      if (currentSid !== sid) {
        const devName = dev === 'mobile' ? 'điện thoại' : 'máy tính (PC/Laptop)';
        throw E(`Tài khoản đã đăng nhập trên một ${devName} khác. Phiên này đã tự động đăng xuất để bảo vệ an toàn cho vé.`, 401);
      }

      if (typeof role === 'string' && u.role !== role) throw E('Không có quyền truy cập', 403);
      if (!u.wallet) {
        u.wallet = chain.getWalletAddress(u.id);
        await db.run('UPDATE users SET wallet=? WHERE id=?', [u.wallet, u.id]);
      }
      r.u = u;
      r.sessionDev = dev;
      n();
    } else if (parts.length === 3) {
      // Tương thích phiên cũ: id.exp.sg
      [id, exp, sg] = parts;
      if (!sg || sign(id + '.' + exp).slice(0, 32) !== sg || +exp < Date.now()) throw E('Chưa đăng nhập', 401);
      const u = await db.get('SELECT * FROM users WHERE id=?', [id]);
      if (!u) throw E('Chưa đăng nhập', 401);
      if (u.status === 'locked') throw E('Tài khoản của bạn đã bị quản trị viên tạm khóa', 403);
      if (typeof role === 'string' && u.role !== role) throw E('Không có quyền truy cập', 403);
      if (!u.wallet) {
        u.wallet = chain.getWalletAddress(u.id);
        await db.run('UPDATE users SET wallet=? WHERE id=?', [u.wallet, u.id]);
      }
      r.u = u;
      r.sessionDev = getDeviceType(r);
      n();
    } else {
      throw E('Chưa đăng nhập', 401);
    }
  } catch (e) { n(e); }
};
const route = (m, p, role, f) => app[m]('/api/' + p, ...(role ? [auth(role)] : []), (r, s, n) => Promise.resolve().then(async () => { if (m === 'post' && ['buy','buy-resale'].includes(p) && !isDemoOtpBypass(r.u)) { const code=String(r.body.code || '').trim(); if (!code) throw E('Vui lòng nhập mã OTP để xác nhận mua vé'); await verifyOtp(r.u.id,'buy_ticket',code); } return (m === 'post' && /^(buy$|buy-resale$|list$|unlist$|scan$|topup$|(?:admin\/)?events\/:id\/cancel$)/.test(p)) ? db.transaction(() => f(r, s)) : f(r, s); }).then(d => s.json(d)).catch(n));
const log = async (u, t, a, n, txHash = null, eventId = null) => {
  const r = await db.run('INSERT INTO txs(user,type,amount,note,tx_hash,event_id) VALUES(?,?,?,?,?,?)', [u, t, a, n, txHash, eventId]);
  return r.lastInsertRowid;
};

// ─── OTP ─────────────────────────────────────────────────────────────────────
const PASS_RE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
const OTP_TTL = 5 * 60 * 1000, OTP_COOLDOWN = 30 * 1000, OTP_MAX_ATTEMPTS = 5;
const DEMO_BYPASS_USERS = new Set(['demo_customer', 'demo_organizer']);
const isDemoOtpBypass = u => (process.env.DEMO_OTP_BYPASS === '1' || process.env.DEMO_OTP_BYPASS === 'true') && Boolean(u && DEMO_BYPASS_USERS.has(String(u.username || '').toLowerCase()));
const otpHash = (uid, purpose, code) => sign(`${uid}|${purpose}|${code}`);
const maskEmail = e => {
  const [n, d] = String(e || '').split('@');
  if (!d) return e;
  return (n.length <= 2 ? n[0] + '*' : n.slice(0, 2) + '***') + '@' + d;
};
const maskPhone = p => {
  const s = String(p || '').trim();
  return s.length >= 6 ? s.slice(0, 3) + '****' + s.slice(-3) : s ? '***' : '';
};
const maskCccd = c => {
  const s = String(c || '').trim();
  return s.length >= 4 ? '********' + s.slice(-4) : null;
};
const maskBank = b => {
  const parts = String(b || '').split(' - ');
  if (parts.length < 2) return b ? '****' : '';
  const numStr = parts.slice(1).join(' - ').trim();
  return `${parts[0]} - ${numStr.length >= 4 ? '****' + numStr.slice(-4) : '****'}`;
};
const currentUserOpt = async r => {
  try {
    const raw = cookies(r).t || '';
    const parts = raw.split('.');
    if (parts.length === 5) {
      const [id, exp, dev, sid, sg] = parts;
      if (!sg || sign(`${id}.${exp}.${dev}.${sid}`).slice(0, 32) !== sg || +exp < Date.now()) return null;
      const u = await db.get('SELECT * FROM users WHERE id=?', [id]);
      if (!u) return null;
      const currentSid = dev === 'mobile' ? u.session_mobile : u.session_desktop;
      if (currentSid !== sid) return null;
      return u;
    } else if (parts.length === 3) {
      const [id, exp, sg] = parts;
      if (!sg || sign(id + '.' + exp).slice(0, 32) !== sg || +exp < Date.now()) return null;
      return await db.get('SELECT * FROM users WHERE id=?', [id]) || null;
    }
    return null;
  } catch { return null; }
};
const resolveVerifyUser = async r => {
  const logged = await currentUserOpt(r);
  if (logged) return logged;
  const uname = String(r.body.username || '').trim();
  if (!uname) throw E('Vui lòng nhập tên đăng nhập cần xác thực email');
  const u = await db.get('SELECT * FROM users WHERE username=?', [uname]);
  if (!u) throw E('Không tìm thấy tài khoản');
  return u;
};
const resolveResetUser = async identifier => {
  const id = String(identifier || '').trim();
  if (!id) throw E('Vui lòng nhập tên đăng nhập hoặc email');
  const byUser = await db.get('SELECT * FROM users WHERE username=?', [id]);
  if (byUser) return byUser;
  const byEmail = await db.all('SELECT * FROM users WHERE lower(email)=lower(?)', [id]);
  if (!byEmail.length) throw E('Không tìm thấy tài khoản phù hợp');
  if (byEmail.length > 1) throw E('Email này dùng cho nhiều tài khoản. Vui lòng nhập chính xác Tên đăng nhập.');
  return byEmail[0];
};
const pendingOtp = new Set();
async function issueOtp(user, purpose) {
  if (!mailer.isSmtpConfigured()) throw E('Dịch vụ gửi email chưa được cấu hình. Vui lòng liên hệ quản trị viên.', 503);
  const pendingKey = `${user.id}:${purpose}`;
  if (pendingOtp.has(pendingKey)) throw E('Mã OTP đang được gửi. Vui lòng đợi trước khi thử lại.', 429);
  pendingOtp.add(pendingKey);
  try {
  const now = Date.now();
  const prev = await db.get('SELECT * FROM otps WHERE user_id=? AND purpose=? AND used=0 ORDER BY id DESC LIMIT 1', [user.id, purpose]);
  if (prev && now - prev.created_at < OTP_COOLDOWN) {
    const wait = Math.ceil((OTP_COOLDOWN - (now - prev.created_at)) / 1000);
    throw E(`Vui lòng đợi ${wait} giây trước khi gửi lại mã OTP`, 429);
  }
  await db.run('UPDATE otps SET used=1 WHERE user_id=? AND purpose=? AND used=0', [user.id, purpose]);
  const code = String(crypto.randomInt(100000, 1000000));
  const inserted = await db.run(
    'INSERT INTO otps(user_id,email,purpose,code_hash,expires_at,created_at,used) VALUES(?,?,?,?,?,?,1)',
    [user.id, user.email, purpose, otpHash(user.id, purpose, code), now + OTP_TTL, now]
  );
  // A code becomes usable only after the mail server has accepted its message.
  // Failed delivery leaves the pending row invalid, with no resend cooldown.
  await mailer.sendOtpEmail({ to: user.email, username: user.username, code, purpose });
  await db.run('UPDATE otps SET used=0 WHERE id=?', [inserted.lastInsertRowid]);
  return { mode: 'smtp', maskedEmail: maskEmail(user.email), expiresIn: 300 };
  } finally {
    pendingOtp.delete(pendingKey);
  }
}
async function verifyOtp(userId, purpose, rawCode) {
  const code = String(rawCode || '').trim();
  if (!/^\d{6}$/.test(code)) throw E('Mã OTP phải gồm 6 chữ số');
  const row = await db.get('SELECT * FROM otps WHERE user_id=? AND purpose=? AND used=0 ORDER BY id DESC LIMIT 1', [userId, purpose]);
  if (!row) throw E('Chưa có mã OTP hợp lệ. Vui lòng bấm gửi mã mới');
  if (row.expires_at < Date.now()) {
    await db.run('UPDATE otps SET used=1 WHERE id=?', [row.id]);
    throw E('Mã OTP đã hết hạn (quá 5 phút), vui lòng gửi lại mã mới');
  }
  if (otpHash(userId, purpose, code) !== row.code_hash) {
    await db.run('UPDATE otps SET attempts=attempts+1, used=CASE WHEN attempts+1>=? THEN 1 ELSE used END WHERE id=? AND used=0', [OTP_MAX_ATTEMPTS, row.id]);
    const latest = await db.get('SELECT attempts FROM otps WHERE id=?', [row.id]);
    const nextAttempts = Number(latest.attempts);
    if (nextAttempts >= OTP_MAX_ATTEMPTS) {
      throw E('Nhập sai OTP quá 5 lần. Vui lòng yêu cầu mã OTP mới');
    }
    throw E(`Mã OTP không chính xác (còn ${OTP_MAX_ATTEMPTS - nextAttempts} lần thử)`);
  }
  const consumed = await db.run('UPDATE otps SET used=1 WHERE id=? AND used=0 AND expires_at>=? AND attempts<?', [row.id, Date.now(), OTP_MAX_ATTEMPTS]);
  if (Number(consumed.rowsAffected) !== 1) throw E('Mã OTP đã được sử dụng. Vui lòng gửi mã mới.');
}

// ─── Auth routes ─────────────────────────────────────────────────────────────
route('post', 'register', 0, async r => {
  const pin = pinSecurity.credentials(r.body.pin, r.body.pinConfirmation);
  const { username: u, password: p, bank, role, cccd } = r.body;
  const email = String(r.body.email || '').trim().toLowerCase();
  const phone = String(r.body.phone || '').trim();
  if (!/^.{8,}$/.test(u || '')) throw E('Tên đăng nhập tối thiểu 8 ký tự');
  if (!PASS_RE.test(p || '')) throw E('Mật khẩu tối thiểu 8 ký tự, gồm 1 chữ in hoa và 1 chữ số');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) throw E('Email không hợp lệ');
  if (!/^0\d{9}$/.test(phone || '')) throw E('Số điện thoại phải gồm 10 số, bắt đầu bằng 0');
  if (!/^.{3,} - \d{6,}$/.test(bank || '')) throw E('Vui lòng liên kết tài khoản ngân hàng hợp lệ');
  if (!['customer', 'organizer'].includes(role)) throw E('Loại tài khoản không hợp lệ');
  if (role === 'organizer' && !/^\d{12}$/.test(cccd || '')) throw E('Nhà cung cấp cần nhập CCCD gồm 12 số để xác minh');
  if (await db.get('SELECT 1 FROM users WHERE username=?', [u])) throw E('Tên đăng nhập đã tồn tại');
  if (await db.get('SELECT 1 FROM users WHERE lower(trim(email))=?', [email])) throw E('Email đã được sử dụng cho tài khoản khác.', 409);
  if (await db.get('SELECT 1 FROM users WHERE trim(phone)=?', [phone])) throw E('Số điện thoại đã được sử dụng cho tài khoản khác.', 409);
  const salt = crypto.randomBytes(16).toString('hex');
  const initialStatus = role === 'organizer' ? 'pending' : 'active';
  const info = await db.run(
    'INSERT INTO users(username,hash,salt,email,phone,bank,role,cccd,email_verified,status) VALUES(?,?,?,?,?,?,?,?,0,?)',
    [u, hash(p, salt), salt, email, phone, bank, role, role === 'organizer' ? cccd : null, initialStatus]
  );
  const userId = Number(info.lastInsertRowid);
  const wallet = chain.getWalletAddress(userId);
  await db.run('UPDATE users SET wallet=?,pin_hash=?,pin_salt=? WHERE id=?', [wallet, pin.hash, pin.salt, userId]);
  const newUser = await db.get('SELECT * FROM users WHERE id=?', [userId]);
  let otpInfo = {};
  try { otpInfo = await issueOtp(newUser, 'verify_email'); } catch (e) { otpInfo = { otpError: e.message }; }
  return { ok: 1, wallet, needVerify: true, username: u, ...otpInfo };
});

route('post', 'verify-email/request', 0, async r => {
  const u = await resolveVerifyUser(r);
  if (u.email_verified) throw E('Email tài khoản này đã được xác thực rồi');
  const res = await issueOtp(u, 'verify_email');
  return { ok: 1, username: u.username, ...res };
});

route('post', 'verify-email/confirm', 0, async r => {
  const u = await resolveVerifyUser(r);
  if (u.email_verified) return { ok: 1, emailVerified: true };
  await verifyOtp(u.id, 'verify_email', r.body.code);
  await db.run('UPDATE users SET email_verified=1 WHERE id=?', [u.id]);
  await log(u.id, 'verify_email', 0, `Xác thực email thành công (${u.email})`);
  return { ok: 1, emailVerified: true };
});

route('post', 'change-password/unlock', true, async r => {
  await pinSecurity.verify(r.u.id, r.body.pin);
  return { unlockToken: pinSecurity.passwordGrant(r.u, cookies(r).t) };
});

const authorizePasswordChange = r => {
  if (r.u.pin_hash) pinSecurity.checkPasswordGrant(r.headers['x-password-unlock'], r.u, cookies(r).t);
};

route('post', 'change-password/request', true, async r => {
  authorizePasswordChange(r);
  if (!r.u.email_verified) throw E('Vui lòng xác thực Email trước khi đổi mật khẩu');
  const cur = String(r.body.currentPassword || '');
  if (!cur || hash(cur, r.u.salt) !== r.u.hash) throw E('Mật khẩu hiện tại không đúng', 422);
  const res = await issueOtp(r.u, 'change_password');
  return { ok: 1, ...res };
});

route('post', 'change-password/confirm', true, async r => {
  authorizePasswordChange(r);
  if (!r.u.email_verified) throw E('Vui lòng xác thực Email trước khi đổi mật khẩu');
  const { currentPassword, newPassword, code } = r.body;
  if (!currentPassword || hash(currentPassword, r.u.salt) !== r.u.hash) throw E('Mật khẩu hiện tại không đúng', 422);
  if (!PASS_RE.test(newPassword || '')) throw E('Mật khẩu mới tối thiểu 8 ký tự, gồm 1 chữ in hoa và 1 chữ số');
  if (newPassword === currentPassword) throw E('Mật khẩu mới phải khác mật khẩu hiện tại');
  await verifyOtp(r.u.id, 'change_password', code);
  const salt = crypto.randomBytes(16).toString('hex');
  await db.run('UPDATE users SET hash=?,salt=? WHERE id=?', [hash(newPassword, salt), salt, r.u.id]);
  await log(r.u.id, 'security', 0, 'Đổi mật khẩu (xác thực Mật khẩu cũ + OTP Email)');
  return { ok: 1 };
});

route('post', 'forgot-password/request', 0, async r => {
  const u = await resolveResetUser(r.body.identifier);
  const res = await issueOtp(u, 'reset_password');
  return { ok: 1, username: u.username, ...res };
});

route('post', 'forgot-password/confirm', 0, async r => {
  const u = await resolveResetUser(r.body.identifier);
  const { code, newPassword } = r.body;
  if (!PASS_RE.test(newPassword || '')) throw E('Mật khẩu mới tối thiểu 8 ký tự, gồm 1 chữ in hoa và 1 chữ số');
  await verifyOtp(u.id, 'reset_password', code);
  const salt = crypto.randomBytes(16).toString('hex');
  await db.run('UPDATE users SET hash=?,salt=?,email_verified=1,session_desktop=NULL,session_mobile=NULL WHERE id=?', [hash(newPassword, salt), salt, u.id]);
  await log(u.id, 'security', 0, 'Khôi phục mật khẩu qua OTP Email');
  return { ok: 1 };
});

route('post', 'login', 0, async (r, s) => {
  const u = await db.get('SELECT * FROM users WHERE username=?', [r.body.username || '']);
  if (!u || hash(r.body.password || '', u.salt) !== u.hash) throw E('Sai tên đăng nhập hoặc mật khẩu', 401);
  if (u.status === 'locked') throw E('Tài khoản này đã bị quản trị viên tạm khóa', 403);
  const dev = getDeviceType(r); // 'mobile' | 'desktop'
  const sid = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + 864e5; // 24 giờ

  // Cập nhật phiên đăng nhập theo loại thiết bị (1 PC + 1 Mobile)
  if (dev === 'mobile') {
    await db.run('UPDATE users SET session_mobile=? WHERE id=?', [sid, u.id]);
  } else {
    await db.run('UPDATE users SET session_desktop=? WHERE id=?', [sid, u.id]);
  }

  // Cấu trúc token: id.exp.dev.sid.signature
  const payload = `${u.id}.${exp}.${dev}.${sid}`;
  const sig = sign(payload).slice(0, 32);
  s.setHeader('Set-Cookie', `t=${payload}.${sig}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`);
  return { role: u.role, emailVerified: Boolean(u.email_verified), device: dev };
});

route('post', 'logout', 0, async (r, s) => {
  try {
    const raw = cookies(r).t || '';
    const parts = raw.split('.');
    if (parts.length === 5) {
      const [id, exp, dev, sid] = parts;
      if (dev === 'mobile') {
        await db.run('UPDATE users SET session_mobile=NULL WHERE id=? AND session_mobile=?', [id, sid]);
      } else {
        await db.run('UPDATE users SET session_desktop=NULL WHERE id=? AND session_desktop=?', [id, sid]);
      }
    }
  } catch (_) {}
  s.setHeader('Set-Cookie', 't=; Path=/; Max-Age=0');
  return { ok: 1 };
});

route('get', 'me', true, async r => {
  const { hash: _h, salt: _s, cccd: _c, pin_hash: _ph, pin_salt: _ps, pin_attempts: _pa, pin_locked_until: _pl, session_desktop: _sd, session_mobile: _sm, ...u } = r.u;
  const currentDev = r.sessionDev || getDeviceType(r);
  return {
    ...u,
    pinConfigured: Boolean(r.u.pin_hash),
    emailVerified: Boolean(r.u.email_verified),
    smtpEnabled: mailer.isSmtpConfigured(),
    demoOtpBypass: isDemoOtpBypass(r.u),
    chainEnabled: chain.isEnabled(),
    chain: chain.getStatus(),
    currentDevice: currentDev,
    activeSessions: {
      desktop: Boolean(r.u.session_desktop),
      mobile: Boolean(r.u.session_mobile)
    }
  };
});
route('get', 'chain', 0, () => chain.getStatus());

route('post', 'security/pin/setup', true, async r => {
  if (r.u.pin_hash) throw E('Tài khoản đã có mã bảo mật. Hãy dùng chức năng đổi mã.', 409);
  if (hash(String(r.body.currentPassword || ''), r.u.salt) !== r.u.hash) throw E('Mật khẩu hiện tại không đúng', 422);
  const pin = pinSecurity.credentials(r.body.pin, r.body.pinConfirmation);
  const updated = await db.run('UPDATE users SET pin_hash=?,pin_salt=?,pin_attempts=0,pin_locked_until=0 WHERE id=? AND pin_hash IS NULL', [pin.hash, pin.salt, r.u.id]);
  if (Number(updated.rowsAffected) !== 1) throw E('Mã bảo mật đã được tạo. Vui lòng tải lại trang.', 409);
  return { ok: 1 };
});
route('post', 'security/pin/verify', 0, async r => {
  const user = await currentUserOpt(r) || await resolveResetUser(r.body.identifier || r.body.username);
  if (!user) throw E('Tên tài khoản hoặc mã bảo mật không đúng.', 422);
  await pinSecurity.verify(user.id, r.body.pin);
  return { ok: 1 };
});
route('post', 'security/pin/change', true, async r => {
  if (hash(String(r.body.currentPassword || ''), r.u.salt) !== r.u.hash) throw E('Mật khẩu hiện tại không đúng', 422);
  const pin = pinSecurity.credentials(r.body.pin, r.body.pinConfirmation);
  await pinSecurity.verify(r.u.id, r.body.oldPin);
  const updated = await db.run('UPDATE users SET pin_hash=?,pin_salt=?,pin_attempts=0,pin_locked_until=0 WHERE id=? AND pin_hash=?', [pin.hash, pin.salt, r.u.id, r.u.pin_hash]);
  if (Number(updated.rowsAffected) !== 1) throw E('Thông tin bảo mật đã thay đổi. Vui lòng thử lại.', 409);
  return { ok: 1 };
});
route('post', 'security/pin/reset/request', 0, async r => {
  const u = await currentUserOpt(r) || await resolveResetUser(r.body.identifier);
  if (!u.email_verified) throw E('Cần xác thực email trước khi khôi phục mã bảo mật.');
  if (hash(String(r.body.currentPassword || ''), u.salt) !== u.hash) throw E('Mật khẩu hiện tại không đúng', 422);
  return { ok: 1, ...await issueOtp(u, 'reset_pin') };
});
route('post', 'security/pin/reset/confirm', 0, async r => {
  const u = await currentUserOpt(r) || await resolveResetUser(r.body.identifier);
  if (!u.email_verified) throw E('Cần xác thực email trước khi khôi phục mã bảo mật.');
  if (hash(String(r.body.currentPassword || ''), u.salt) !== u.hash) throw E('Mật khẩu hiện tại không đúng', 422);
  const pin = pinSecurity.credentials(r.body.pin, r.body.pinConfirmation);
  await verifyOtp(u.id, 'reset_pin', r.body.code);
  await db.run('UPDATE users SET pin_hash=?,pin_salt=?,pin_attempts=0,pin_locked_until=0 WHERE id=?', [pin.hash, pin.salt, u.id]);
  return { ok: 1 };
});
route('post', 'qr/:id/unlock', 'customer', async r => {
  const ticket = await db.get('SELECT id FROM tickets WHERE id=? AND owner=?', [r.params.id, r.u.id]);
  if (!ticket) throw E('Không tìm thấy vé của bạn.', 404);
  await pinSecurity.verify(r.u.id, r.body.pin);
  return { unlockToken: pinSecurity.ticketGrant(r.u, ticket.id, cookies(r).t || '') };
});

route('post', 'profile/avatar', true, async r => {
  const avatar = await normalizeAvatar(r.body.avatar);
  await db.run('UPDATE users SET avatar=? WHERE id=?', [avatar, r.u.id]);
  return { ok: 1, avatar };
});
const preparingAvatars = new Set();
route('post', 'profile/avatar/prepare', true, async r => {
  if (preparingAvatars.has(r.u.id) || preparingAvatars.size >= 2) throw E('Ảnh đang được xử lý. Vui lòng thử lại sau ít giây.', 429);
  preparingAvatars.add(r.u.id);
  try {
    return { image: await prepareAvatar(r.body.image) };
  } finally {
    preparingAvatars.delete(r.u.id);
  }
});

// ─── Topup ────────────────────────────────────────────────────────────────────
route('post', 'topup', true, async r => {
  const a = int(r.body.amount, 10000, 50000000, 'Số tiền nạp từ 10.000đ đến 50.000.000đ');
  if (!METHODS.includes(r.body.method)) throw E('Vui lòng chọn phương thức thanh toán');
  await db.run('UPDATE users SET balance=balance+? WHERE id=?', [a, r.u.id]);
  await log(r.u.id, 'topup', a, r.body.method);
  return { ok: 1 };
});

// ─── Events ───────────────────────────────────────────────────────────────────
const evSql = "SELECT e.*,u.username org FROM events e JOIN users u ON u.id=e.org WHERE (e.status != 'cancelled' OR e.status IS NULL)";
route('get', 'events', true, () => db.all(evSql + ' ORDER BY e.date'));
route('post', 'events', 'organizer', async r => {
  if (r.u.status !== 'active') throw E('Tài khoản Ban tổ chức đang chờ Admin duyệt CCCD nên chưa thể mở bán sự kiện', 403);
  const b = r.body, name = String(b.name || '').trim(), venue = String(b.venue || '').trim();
  const desc = String(b.description || '').trim();
  const image = String(b.image || '').trim();
  const maxPerUser = Math.max(0, parseInt(b.max_per_user, 10) || 0);
  if (!name || !venue) throw E('Nhập đủ tên sự kiện và địa điểm');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || b.date < new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)) throw E('Ngày tổ chức không hợp lệ');
  const price = int(b.price, 0, 100000000, 'Giá vé không hợp lệ'), total = int(b.total, 1, 100000, 'Số lượng vé phải là số nguyên dương');
  await db.run('INSERT INTO events(org,name,date,venue,price,total,remain,description,image,status,max_per_user) VALUES(?,?,?,?,?,?,?,?,?,\'active\',?)', [r.u.id, name, b.date, venue, price, total, total, desc, image, maxPerUser]);
  return { ok: 1 };
});

async function cancelEventAndRefund(ev, { byAdmin = false, adminId = null } = {}) {
  if (ev.status === 'cancelled') throw E('Sự kiện này đã được hủy trước đó rồi');
  const todayVn = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  if (String(ev.date || '') < todayVn) throw E('Không thể hủy show đã diễn ra');

  const tickets = await db.all('SELECT * FROM tickets WHERE event=? AND used != 2', [ev.id]);
  let totalRefund = 0;
  const stmts = [];

  for (const t of tickets) {
    totalRefund += t.orig;
    stmts.push({ sql: 'UPDATE users SET balance=balance+? WHERE id=?', args: [t.orig, t.owner] });
    stmts.push({ sql: 'UPDATE tickets SET used=2, listed=NULL WHERE id=?', args: [t.id] });
    const msg = byAdmin
      ? `Hoàn tiền 100%: Show "${ev.name}" bị Admin đình chỉ (Vé #${t.id})`
      : `Hoàn tiền 100%: Show "${ev.name}" bị hủy (Vé #${t.id})`;
    stmts.push({ sql: 'INSERT INTO txs(user,type,amount,note,tx_hash,event_id) VALUES(?,?,?,?,?,?)', args: [t.owner, 'refund', t.orig, msg, null, ev.id] });
  }

  const orgDeduct = Math.round(totalRefund * (1 - FEE));
  stmts.push({ sql: 'UPDATE users SET balance=balance-? WHERE id=?', args: [orgDeduct, ev.org] });
  stmts.push({
    sql: 'INSERT INTO txs(user,type,amount,note,tx_hash,event_id) VALUES(?,?,?,?,?,?)',
    args: [ev.org, 'refund', -orgDeduct, `${byAdmin ? 'Admin đình chỉ' : 'Hoàn trả doanh thu: Hủy'} show "${ev.name}" (${tickets.length} vé)`, null, ev.id]
  });
  stmts.push({ sql: "UPDATE events SET status='cancelled' WHERE id=?", args: [ev.id] });
  if (byAdmin && adminId) {
    stmts.push({
      sql: 'INSERT INTO txs(user,type,amount,note,tx_hash,event_id) VALUES(?,?,?,?,?,?)',
      args: [adminId, 'admin', 0, `Đình chỉ & hoàn tiền 100% show vi phạm "${ev.name}" (${tickets.length} vé)`, null, ev.id]
    });
  }

  await db.batch(stmts);
  return { ok: 1, refundedTickets: tickets.length, totalRefund };
}

route('post', 'events/:id/cancel', 'organizer', async r => {
  const evId = +r.params.id;
  const ev = await db.get('SELECT * FROM events WHERE id=? AND org=?', [evId, r.u.id]);
  if (!ev) throw E('Không tìm thấy sự kiện hoặc bạn không có quyền hủy sự kiện này', 404);
  return cancelEventAndRefund(ev, { byAdmin: false });
});

route('post', 'events/:id/image', 'organizer', async r => {
  const evId = +r.params.id;
  const ev = await db.get('SELECT * FROM events WHERE id=? AND org=?', [evId, r.u.id]);
  if (!ev) throw E('Không tìm thấy sự kiện hoặc bạn không có quyền sửa sự kiện này', 404);
  const image = String(r.body.image || '').trim();
  await db.run('UPDATE events SET image=? WHERE id=?', [image, evId]);
  return { ok: 1, image };
});

route('get', 'stats', 'organizer', async r => {
  const events = await db.all('SELECT * FROM events WHERE org=? ORDER BY date', [r.u.id]);
  const result = [];
  for (const e of events) {
    const isCancelled = e.status === 'cancelled';
    const checked = await db.get('SELECT COUNT(*) c FROM tickets WHERE event=? AND used=1', [e.id]);
    const listed  = await db.get('SELECT COUNT(*) c FROM tickets WHERE event=? AND listed IS NOT NULL AND used=0', [e.id]);
    const activeSoldRow = await db.get('SELECT COUNT(*) c FROM tickets WHERE event=? AND used != 2', [e.id]);
    const refundedRow   = await db.get('SELECT COUNT(*) c FROM tickets WHERE event=? AND used=2', [e.id]);

    const activeSold = activeSoldRow?.c || 0;
    const refunded   = refundedRow?.c || 0;

    // Show đã hủy:
    // 1) Số vé đã phân phối hiện tại = 0 (toàn bộ vé đã bán trước đó đã hoàn tiền 100%)
    // 2) Doanh thu thực nhận = 0đ (doanh thu đã được khấu trừ hoàn lại cho khán giả)
    const sold = isCancelled ? 0 : (activeSold > 0 ? activeSold : Math.max(0, e.total - e.remain));
    const revenue = isCancelled ? 0 : Math.round(sold * e.price * (1 - FEE));

    result.push({
      ...e,
      sold,
      refunded,
      revenue,
      checked: isCancelled ? 0 : checked.c,
      listed: isCancelled ? 0 : listed.c
    });
  }
  return result;
});

route('get', 'stats/daily', 'organizer', async r => {
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const rows = await db.all(`
    SELECT t.event AS event_id,
           substr(datetime(COALESCE(t.created_at, CURRENT_TIMESTAMP), '+7 hours'), 1, 10) AS day,
           COUNT(*) AS qty,
           SUM(ROUND(t.orig * (1 - ?))) AS revenue
    FROM tickets t
    JOIN events e ON e.id = t.event
    WHERE e.org = ? AND t.used != 2 AND (e.status != 'cancelled' OR e.status IS NULL)
    GROUP BY t.event, substr(datetime(COALESCE(t.created_at, CURRENT_TIMESTAMP), '+7 hours'), 1, 10)
    ORDER BY day ASC
  `, [FEE, r.u.id]);
  return { today, rows };
});

route('get', 'chain-jobs', true, async r => ({ jobs: await db.all('SELECT j.id,j.action,j.state,j.tx_hash,j.error,j.created_at FROM chain_jobs j JOIN tickets t ON t.id=j.ticket_id WHERE t.owner=? ORDER BY j.id DESC LIMIT 50',[r.u.id]) }));

// ─── Pay helper ───────────────────────────────────────────────────────────────
const pay = async (buyer, seller, price, note, eventId = null) => {
  const b = await db.get('SELECT balance FROM users WHERE id=?', [buyer]);
  if (b.balance < price) throw E('Số dư ví không đủ, vui lòng nạp thêm');
  const net = Math.round(price * (1 - FEE));
  await db.batch([
    { sql: 'UPDATE users SET balance=balance-? WHERE id=?', args: [price, buyer] },
    { sql: 'UPDATE users SET balance=balance+? WHERE id=?', args: [net, seller] },
  ]);
  const buyerTxId  = await log(buyer,  'buy',  -price, note, null, eventId);
  const sellerTxId = await log(seller, 'sale',  net,   note, null, eventId);
  return { buyerTxId, sellerTxId };
};

const isActiveContractTicket = t => t && chain.isEnabled() &&
  (!t.contract_addr || t.contract_addr === chain.getStatus().avaTicketAddress);

// ─── Buy (Primary) & Buy OTP ──────────────────────────────────────────────────
route('post', 'buy/request-otp', 'customer', async r => {
  if (isDemoOtpBypass(r.u)) {
    return { ok: 1, bypass: true, maskedEmail: maskEmail(r.u.email) };
  }
  const res = await issueOtp(r.u, 'buy_ticket');
  return { ok: 1, ...res };
});

route('post', 'buy', 'customer', async r => {


  const eventId = +r.body.event;
  const e = await db.get('SELECT * FROM events WHERE id=?', [eventId]);
  if (!e) throw E('Không tìm thấy sự kiện');
  if (e.status === 'cancelled') throw E('Sự kiện này đã bị hủy, không thể mua vé');
  if (String(e.date) < new Date(Date.now()+7*3600000).toISOString().slice(0,10)) throw E('Sự kiện đã kết thúc');
  if (e.remain <= 0) throw E('Sự kiện đã SOLD OUT');

  if (e.max_per_user > 0) {
    const row = await db.get('SELECT COUNT(*) cnt FROM tickets WHERE event=? AND owner=? AND used != 2', [e.id, r.u.id]);
    if ((row?.cnt || 0) >= e.max_per_user) {
      throw E(`Chống gom vé: Sự kiện này giới hạn mỗi khán giả chỉ được mua tối đa ${e.max_per_user} vé`);
    }
  }
  const { buyerTxId, sellerTxId } = await pay(r.u.id, e.org, e.price, e.name, e.id);
  await db.run('UPDATE events SET remain=remain-1 WHERE id=?', [eventId]);
  const ins = await db.run('INSERT INTO tickets(event,owner,orig,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP)', [eventId, r.u.id, e.price]);
  const ticketId = Number(ins.lastInsertRowid);
  const chainRes = await chain.onBuyPrimary(ticketId, r.u.wallet, e.id, e.price, {historyIds:[buyerTxId,sellerTxId]});
  if (chainRes) {
    const contractAddr = chain.getStatus().avaTicketAddress;
    await db.run('UPDATE tickets SET token_id=?,tx_hash=?,contract_addr=? WHERE id=?', [chainRes.tokenId, chainRes.txHash, contractAddr, ticketId]);
    await db.run('UPDATE txs SET tx_hash=? WHERE id IN (?,?)', [chainRes.txHash, buyerTxId, sellerTxId]);
  }
  return { ok: 1, ticketId, tokenId: chainRes?.tokenId || null, txHash: chainRes?.txHash || null, explorerUrl: chain.explorerUrl(chainRes?.txHash) };
});

// ─── Tickets & Market ─────────────────────────────────────────────────────────
route('get', 'tickets', 'customer', r => db.all(
  'SELECT t.*,e.name,e.date,e.venue,e.description,e.image,e.status event_status,e.date,e.max_per_user,u.username org FROM tickets t JOIN events e ON e.id=t.event JOIN users u ON u.id=e.org WHERE t.owner=? ORDER BY t.id DESC', [r.u.id]
));

route('get', 'tickets/:id/chain', true, async r => {
  const t = await db.get('SELECT t.*,e.name,e.org,u.wallet ownerWallet FROM tickets t JOIN events e ON e.id=t.event JOIN users u ON u.id=t.owner WHERE t.id=?', [+r.params.id]);
  if (!t || (t.owner !== r.u.id && t.org !== r.u.id)) throw E('Không tìm thấy vé', 404);
  const onChain = isActiveContractTicket(t) ? await chain.getOnChainTicket(t.token_id) : null;
  return { ticket: t, onChain, chainStatus: chain.getStatus(), explorerUrl: chain.explorerUrl(t.tx_hash) };
});

route('post', 'list', 'customer', async r => {
  const t = await db.get('SELECT * FROM tickets WHERE id=? AND owner=?', [+r.body.ticket, r.u.id]);
  if (!t) throw E('Bạn không sở hữu vé này');
  if (t.used) throw E('Vé không còn hiệu lực để bán lại');
  const event = await db.get('SELECT date,status FROM events WHERE id=?',[t.event]);
  if (!event || event.status === 'cancelled' || String(event.date) < new Date(Date.now()+7*3600000).toISOString().slice(0,10)) throw E('Sự kiện đã kết thúc hoặc bị hủy');
  const max = Math.floor(t.orig * CAP), p = int(r.body.price, 1, Infinity, 'Giá không hợp lệ');
  if (p > max) throw E('Chống phe vé: giá bán tối đa là ' + max.toLocaleString('vi-VN') + 'đ (giá gốc + 10%)');
  await db.run('UPDATE tickets SET listed=? WHERE id=?', [p, t.id]);
  let chainRes = null;
  if (isActiveContractTicket(t)) {
    chainRes = await chain.onListResale(t.token_id, r.u.wallet, p, t.id);
    if (chainRes?.txHash) await log(r.u.id, 'list', 0, `Đăng bán vé #${t.id} (NFT #${t.token_id}) giá ${p.toLocaleString('vi-VN')}đ`, chainRes.txHash);
  }
  return { ok: 1, txHash: chainRes?.txHash || null, explorerUrl: chain.explorerUrl(chainRes?.txHash) };
});

route('post', 'unlist', 'customer', async r => {
  const t = await db.get('SELECT * FROM tickets WHERE id=? AND owner=?', [+r.body.ticket, r.u.id]);
  if (!t) throw E('Bạn không sở hữu vé này');
  await db.run('UPDATE tickets SET listed=NULL WHERE id=? AND owner=?', [t.id, r.u.id]);
  let chainRes = null;
  if (isActiveContractTicket(t)) chainRes = await chain.onUnlistResale(t.token_id, r.u.wallet, t.id);
  return { ok: 1, txHash: chainRes?.txHash || null };
});

route('get', 'market', 'customer', () => db.all(
  'SELECT t.id,t.owner,t.listed,t.orig,t.token_id,t.tx_hash,e.name,e.date,e.venue,e.description,e.image,e.max_per_user,u.username seller FROM tickets t JOIN events e ON e.id=t.event JOIN users u ON u.id=t.owner WHERE t.listed IS NOT NULL AND t.used=0 AND (e.status != \'cancelled\' OR e.status IS NULL)'
));

// ─── Buy Resale ───────────────────────────────────────────────────────────────
route('post', 'buy-resale', 'customer', async r => {


  const ticketId = +r.body.ticket;
  const t = await db.get('SELECT t.*,e.name,e.status event_status,e.date,e.max_per_user FROM tickets t JOIN events e ON e.id=t.event WHERE t.id=? AND t.listed IS NOT NULL AND t.used=0', [ticketId]);
  if (!t) throw E('Vé không còn được rao bán');
  if (String(t.date) < new Date(Date.now()+7*3600000).toISOString().slice(0,10)) throw E('Sự kiện đã kết thúc');
  if (t.event_status === 'cancelled') throw E('Sự kiện này đã bị hủy, không thể giao dịch vé');
  if (t.owner === r.u.id) throw E('Không thể tự mua vé của mình');

  if (t.max_per_user > 0) {
    const row = await db.get('SELECT COUNT(*) cnt FROM tickets WHERE event=? AND owner=? AND used != 2', [t.event, r.u.id]);
    if ((row?.cnt || 0) >= t.max_per_user) {
      throw E(`Chống gom vé: Bạn đã sở hữu tối đa ${t.max_per_user} vé của sự kiện này`);
    }
  }

  const { buyerTxId, sellerTxId } = await pay(r.u.id, t.owner, t.listed, t.name + ' (bán lại)', t.event);
  await db.run('UPDATE tickets SET owner=?,listed=NULL WHERE id=?', [r.u.id, ticketId]);
  let chainRes = null;
  if (isActiveContractTicket(t)) {
    chainRes = await chain.onBuyResale(t.token_id, r.u.wallet, t.id, {historyIds:[buyerTxId,sellerTxId]});
    if (chainRes?.txHash) {
      await db.run('UPDATE tickets SET tx_hash=? WHERE id=?', [chainRes.txHash, t.id]);
      await db.run('UPDATE txs SET tx_hash=? WHERE id IN (?,?)', [chainRes.txHash, buyerTxId, sellerTxId]);
    }
  }
  return { ok: 1, tokenId: t.token_id || null, txHash: chainRes?.txHash || null, explorerUrl: chain.explorerUrl(chainRes?.txHash) };
});

// ─── QR động (xoay mỗi 20 giây) ─────────────────────────────────────────────
const STEP = 20;
const W = () => Math.floor(Date.now() / (STEP * 1000)),
  tok = (t, w) => `AVATIX|${t.id}|${t.owner}|${w}|${sign(`${t.id}|${t.owner}|${w}`)}`;

route('get', 'qr/:id', 'customer', async r => {
  pinSecurity.checkTicketGrant(r.get('X-Ticket-Unlock'), r.u, r.params.id, cookies(r).t || '');
  const t = await db.get('SELECT * FROM tickets WHERE id=? AND owner=?', [+r.params.id, r.u.id]);
  if (!t) throw E('Bạn không sở hữu vé này');
  if (t.used === 2) throw E('Sự kiện đã bị hủy và tiền vé đã được hoàn trả');
  if (t.used === 1) throw E('Vé đã được sử dụng trước đó (đã check-in)');
  const token = tok(t, W());
  const svg = await QR.toString(token, { type: 'svg', errorCorrectionLevel: 'H', margin: 2, width: 360 });
  return { svg, token, left: STEP - Math.floor((Date.now() / 1000) % STEP) };
});

// ─── Scan (Check-in) ──────────────────────────────────────────────────────────
route('post', 'scan', 'organizer', async r => {
  const p = String(r.body.token || '').trim().split('|'), [tag, id, own, w, sg] = p;
  if (tag !== 'AVATIX' || p.length !== 5 || sign(`${id}|${own}|${w}`) !== sg) throw E('Mã QR không hợp lệ');
  if (W() - Number(w) > 1 || Number(w) > W()) throw E('Mã QR đã hết hạn (ảnh chụp màn hình không có giá trị)');
  const t = await db.get('SELECT t.*,e.org,e.name,e.date FROM tickets t JOIN events e ON e.id=t.event WHERE t.id=?', [+id]);
  if (!t || t.org !== r.u.id) throw E('Vé không thuộc sự kiện của bạn');
  if (String(t.date) !== new Date(Date.now()+7*3600000).toISOString().slice(0,10)) throw E('Chỉ được check-in trong ngày sự kiện');
  if (t.owner !== +own) throw E('Vé đã đổi chủ, mã cũ không còn hiệu lực');
  if (t.used === 2) throw E('Vé không hợp lệ: Sự kiện đã bị hủy và tiền vé đã hoàn trả cho khán giả');
  if (t.used) throw E('Vé đã được sử dụng trước đó');
  await db.run('UPDATE tickets SET used=1,listed=NULL WHERE id=?', [t.id]);
  let chainRes = null;
  if (isActiveContractTicket(t)) {
    const totpTs = Number(w) * STEP;
    chainRes = await chain.onScanTicket(t.token_id, totpTs, t.id);
  }
  await log(r.u.id, 'scan', 0, `Check-in vé #${t.id}: ${t.name}`, chainRes?.txHash || null, t.event);
  return { ok: 1, msg: `Check-in thành công: ${t.name} (vé #${t.id})`, tokenId: t.token_id || null, txHash: chainRes?.txHash || null, explorerUrl: chain.explorerUrl(chainRes?.txHash), chainEnabled: chain.isEnabled() };
});

// ─── Lịch sử giao dịch ───────────────────────────────────────────────────────
const fmtVnTime = s => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : String(s || '');
};

route('get', 'history', true, async r => {
  const rows = await db.all("SELECT txs.*, datetime(txs.at, '+7 hours') AS at_vn, j.state AS chain_state FROM txs LEFT JOIN chain_job_history h ON h.tx_id=txs.id LEFT JOIN chain_jobs j ON j.id=h.job_id WHERE txs.user=? ORDER BY txs.id DESC LIMIT 50", [r.u.id]);
  // Compatibility for primary purchases created before explicit job/history links.
  // Only attach evidence when event, exact time, amount, buyer wallet and job
  // all identify a single candidate. Ambiguous history remains unverified.
  for (const tx of rows) {
    if (tx.tx_hash || tx.chain_state || tx.type !== 'buy') continue;
    const candidates = await db.all("SELECT j.state,j.tx_hash,j.args FROM chain_jobs j JOIN tickets t ON t.id=j.ticket_id JOIN events e ON e.id=t.event WHERE j.action='onBuyPrimary' AND t.event=? AND t.created_at=? AND t.orig=? AND e.name=?",[tx.event_id,tx.at,-tx.amount,tx.note]);
    const matching = candidates.filter(job => {
      try { return String(JSON.parse(job.args)[1]).toLowerCase() === String(r.u.wallet).toLowerCase(); } catch { return false; }
    });
    const duplicates = await db.get("SELECT COUNT(*) n FROM txs WHERE user=? AND type='buy' AND event_id=? AND at=? AND amount=? AND note=?",[r.u.id,tx.event_id,tx.at,tx.amount,tx.note]);
    if (matching.length === 1 && duplicates.n === 1) {
      tx.chain_state=matching[0].state;
      if (matching[0].state === 'confirmed') tx.tx_hash=matching[0].tx_hash;
    }
  }
  return rows.map(tx => ({
    ...tx,
    at: fmtVnTime(tx.at_vn || tx.at),
    explorerUrl: chain.explorerUrl(tx.tx_hash),
    snowtraceUrl: chain.explorerUrl(tx.tx_hash)
  }));
});

// ─── Admin Portal (Chỉ role 'admin') ──────────────────────────────────────────
route('get', 'admin/overview', 'admin', async () => {
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const userStats = await db.get(`
    SELECT
      SUM(CASE WHEN role='customer' THEN 1 ELSE 0 END) AS customers,
      SUM(CASE WHEN role='organizer' THEN 1 ELSE 0 END) AS organizers,
      SUM(CASE WHEN role='organizer' AND status='pending' THEN 1 ELSE 0 END) AS organizersPending,
      SUM(CASE WHEN role='organizer' AND status='active' THEN 1 ELSE 0 END) AS organizersActive,
      SUM(CASE WHEN role='organizer' AND status='locked' THEN 1 ELSE 0 END) AS organizersLocked,
      SUM(CASE WHEN role='customer' AND status='locked' THEN 1 ELSE 0 END) AS customersLocked
    FROM users WHERE role != 'admin'
  `);
  const eventStats = await db.get(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN (status!='cancelled' OR status IS NULL) AND date >= ? THEN 1 ELSE 0 END) AS upcoming,
      SUM(CASE WHEN (status!='cancelled' OR status IS NULL) AND date < ? THEN 1 ELSE 0 END) AS past,
      COALESCE(SUM(CASE WHEN (status!='cancelled' OR status IS NULL) THEN total ELSE 0 END), 0) AS totalCapacity
    FROM events
  `, [today, today]);
  const ticketStats = await db.get(`
    SELECT
      SUM(CASE WHEN t.used != 2 AND (e.status != 'cancelled' OR e.status IS NULL) THEN 1 ELSE 0 END) AS totalSold,
      SUM(CASE WHEN t.used = 1 AND (e.status != 'cancelled' OR e.status IS NULL) THEN 1 ELSE 0 END) AS checkedIn,
      SUM(CASE WHEN t.listed IS NOT NULL AND t.used = 0 AND (e.status != 'cancelled' OR e.status IS NULL) THEN 1 ELSE 0 END) AS listed,
      SUM(CASE WHEN t.used = 2 THEN 1 ELSE 0 END) AS refunded
    FROM tickets t
    JOIN events e ON e.id = t.event
  `);
  const primaryFin = await db.get(`
    SELECT
      COALESCE(SUM(t.orig), 0) AS primaryGross,
      COALESCE(SUM(ROUND(t.orig * (1 - ?))), 0) AS primaryOrgNet
    FROM tickets t
    JOIN events e ON e.id = t.event
    WHERE t.used != 2 AND (e.status != 'cancelled' OR e.status IS NULL)
  `, [FEE]);
  const resaleFin = await db.get(`
    SELECT
      COALESCE(SUM(tx.amount), 0) AS resaleNet,
      COALESCE(SUM(ROUND(tx.amount / (1 - ?))), 0) AS resaleGross
    FROM txs tx
    LEFT JOIN events e ON e.id = tx.event_id
    WHERE tx.type='sale' AND tx.note LIKE '%(bán lại)%' AND (e.status IS NULL OR e.status != 'cancelled')
  `, [FEE]);

  const primaryGross = Number(primaryFin?.primaryGross || 0);
  const primaryOrgNet = Number(primaryFin?.primaryOrgNet || 0);
  const primaryFee5 = Math.max(0, primaryGross - primaryOrgNet);
  const resaleNet = Number(resaleFin?.resaleNet || 0);
  const resaleGross = Number(resaleFin?.resaleGross || 0);
  const resaleFee5 = Math.max(0, resaleGross - resaleNet);
  const relayer = await chain.getRelayerBalance();

  return {
    today,
    users: {
      customers: Number(userStats?.customers || 0),
      organizers: Number(userStats?.organizers || 0),
      organizersPending: Number(userStats?.organizersPending || 0),
      organizersActive: Number(userStats?.organizersActive || 0),
      organizersLocked: Number(userStats?.organizersLocked || 0),
      customersLocked: Number(userStats?.customersLocked || 0),
    },
    events: {
      total: Number(eventStats?.total || 0),
      upcoming: Number(eventStats?.upcoming || 0),
      past: Number(eventStats?.past || 0),
      cancelled: Number(eventStats?.cancelled || 0),
    },
    tickets: {
      totalSold: Number(ticketStats?.totalSold || 0),
      checkedIn: Number(ticketStats?.checkedIn || 0),
      listed: Number(ticketStats?.listed || 0),
      refunded: Number(ticketStats?.refunded || 0),
      totalCapacity: Number(eventStats?.totalCapacity || 0),
    },
    finance: {
      grossVolume: primaryGross + resaleGross,
      primaryFee5,
      resaleFee5,
      totalPlatformFee: primaryFee5 + resaleFee5,
      organizerNetRevenue: primaryOrgNet,
    },
    relayer,
    chain: chain.getStatus(),
  };
});

route('get', 'admin/users', 'admin', async () => {
  const rows = await db.all(`
    SELECT u.id, u.username, u.role, COALESCE(u.status, 'active') AS status,
           u.email, u.phone, u.bank, u.cccd, u.wallet, u.email_verified, u.balance,
           (SELECT COUNT(*) FROM events e WHERE e.org = u.id) AS eventsCount,
           (SELECT COUNT(*) FROM tickets t WHERE t.owner = u.id AND t.used != 2) AS ticketsCount
    FROM users u
    WHERE u.role != 'admin'
    ORDER BY CASE WHEN u.role='organizer' AND u.status='pending' THEN 0 ELSE 1 END, u.id DESC
  `);
  return rows.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    status: u.status || 'active',
    email: maskEmail(u.email),
    phone: maskPhone(u.phone),
    cccd: maskCccd(u.cccd),
    bank: maskBank(u.bank),
    wallet: u.wallet || null,
    emailVerified: Boolean(u.email_verified),
    balance: Number(u.balance || 0),
    eventsCount: Number(u.eventsCount || 0),
    ticketsCount: Number(u.ticketsCount || 0),
  }));
});

route('post', 'admin/users/:id/status', 'admin', async r => {
  const uid = +r.params.id;
  const nextStatus = String(r.body.status || '').trim();
  if (!['active', 'locked'].includes(nextStatus)) throw E('Trạng thái không hợp lệ (chỉ nhận active hoặc locked)');
  const target = await db.get('SELECT id, username, role, status FROM users WHERE id=?', [uid]);
  if (!target) throw E('Không tìm thấy tài khoản', 404);
  if (target.role === 'admin') throw E('Không thể thay đổi trạng thái tài khoản quản trị', 403);

  await db.run('UPDATE users SET status=? WHERE id=?', [nextStatus, uid]);
  if (nextStatus === 'locked') {
    await db.run('UPDATE users SET session_desktop=NULL, session_mobile=NULL WHERE id=?', [uid]);
  }
  await log(r.u.id, 'admin', 0, `${nextStatus === 'active' ? 'Duyệt / Mở khóa' : 'Khóa'} tài khoản ${target.username} (${target.role})`);
  return { ok: 1, id: uid, status: nextStatus };
});

route('get', 'admin/events', 'admin', async () => {
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const events = await db.all(`
    SELECT e.id, e.org, e.name, e.date, e.venue, e.price, e.total, e.remain,
           COALESCE(e.status, 'active') AS status, e.max_per_user,
           u.username AS orgName, COALESCE(u.status, 'active') AS orgStatus
    FROM events e
    JOIN users u ON u.id = e.org
    ORDER BY e.date DESC, e.id DESC
  `);
  const result = [];
  for (const e of events) {
    const isCancelled = e.status === 'cancelled';
    const checkedRow = await db.get('SELECT COUNT(*) c FROM tickets WHERE event=? AND used=1', [e.id]);
    const listedRow = await db.get('SELECT COUNT(*) c FROM tickets WHERE event=? AND listed IS NOT NULL AND used=0', [e.id]);
    const soldRow = await db.get('SELECT COUNT(*) c, COALESCE(SUM(orig),0) gross, COALESCE(SUM(ROUND(orig*(1-?))),0) orgNet FROM tickets WHERE event=? AND used!=2', [FEE, e.id]);
    const refundedRow = await db.get('SELECT COUNT(*) c FROM tickets WHERE event=? AND used=2', [e.id]);

    const sold = isCancelled ? 0 : Number(soldRow?.c || 0);
    const gross = isCancelled ? 0 : Number(soldRow?.gross || 0);
    const revenue = isCancelled ? 0 : Number(soldRow?.orgNet || 0);
    const platformFee = isCancelled ? 0 : Math.max(0, gross - revenue);
    const lifecycle = isCancelled ? 'cancelled' : e.date < today ? 'past' : 'upcoming';

    result.push({
      ...e,
      sold,
      checked: isCancelled ? 0 : Number(checkedRow?.c || 0),
      listed: isCancelled ? 0 : Number(listedRow?.c || 0),
      refunded: Number(refundedRow?.c || 0),
      revenue,
      platformFee,
      lifecycle,
    });
  }
  return result;
});

route('post', 'admin/events/:id/cancel', 'admin', async r => {
  const evId = +r.params.id;
  const ev = await db.get('SELECT * FROM events WHERE id=?', [evId]);
  if (!ev) throw E('Không tìm thấy sự kiện', 404);
  return cancelEventAndRefund(ev, { byAdmin: true, adminId: r.u.id });
});

// ─── Static + Error handler ───────────────────────────────────────────────────
app.use(express.static(__dirname + '/public', { index: 'login.html' }));
app.use((e, r, s, n) => {
  if (String(e.message).includes('EMAIL_ALREADY_USED')) e = E('Email đã được sử dụng cho tài khoản khác.', 409);
  if (String(e.message).includes('PHONE_ALREADY_USED')) e = E('Số điện thoại đã được sử dụng cho tài khoản khác.', 409);
  console.error('[API Error]', e);
  s.status(e.c || 500).json({ e: e.message || 'Lỗi máy chủ' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    await db.migrate();
    // Backfill wallet address cho user cũ chưa có
    const noWallet = await db.all('SELECT id FROM users WHERE wallet IS NULL');
    for (const u of noWallet) {
      await db.run('UPDATE users SET wallet=? WHERE id=?', [chain.getWalletAddress(u.id), u.id]);
    }
    await chain.init();
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log('AVA-TIX chạy tại http://localhost:' + port));
  })();
}

module.exports = { app, db, chain };
