const crypto = require('node:crypto');

module.exports = (db, secret) => {
  const fail = (message, c = 422) => Object.assign(new Error(message), { c });
  const locks = new Map();
  const digest = text => crypto.createHmac('sha256', secret).update(text).digest('hex');
  const hash = (pin, salt) => crypto.scryptSync(digest('pin|' + pin), salt, 32).toString('hex');
  const valid = pin => typeof pin === 'string' && /^\d{6}$/.test(pin);
  const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  function credentials(pin, confirmation) {
    if (!valid(pin)) throw fail('Mã bảo mật phải gồm đúng 6 chữ số.');
    if (pin !== confirmation) throw fail('Mã bảo mật xác nhận không khớp.');
    const salt = crypto.randomBytes(16).toString('hex');
    return { salt, hash: hash(pin, salt) };
  }
  // Serialize verification per account so simultaneous wrong attempts cannot
  // bypass the account-wide limit. Attempts and lockout survive restarts.
  async function verify(userId, pin) {
    const previous = locks.get(userId) || Promise.resolve();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    locks.set(userId, next);
    await previous;
    try {
      const u = await db.get('SELECT pin_hash,pin_salt,pin_attempts,pin_locked_until FROM users WHERE id=?', [userId]);
      if (!u?.pin_hash) throw fail('Hãy đăng nhập và tạo mã bảo mật 6 số trước.', 409);
      if (Number(u.pin_locked_until) > Date.now()) throw fail('Mã bảo mật tạm khóa. Vui lòng thử lại sau 5 phút hoặc khôi phục qua email.', 429);
      if (!valid(pin) || !equal(hash(pin, u.pin_salt), u.pin_hash)) {
        const attempts = Number(u.pin_locked_until) > 0 ? 1 : Number(u.pin_attempts || 0) + 1;
        await db.run('UPDATE users SET pin_attempts=?,pin_locked_until=? WHERE id=?', [attempts, attempts >= 5 ? Date.now() + 300000 : 0, userId]);
        throw fail(attempts >= 5 ? 'Nhập sai 5 lần. Mã bảo mật tạm khóa trong 5 phút.' : `Mã bảo mật không đúng. Còn ${5 - attempts} lần thử.`, attempts >= 5 ? 429 : 422);
      }
      await db.run('UPDATE users SET pin_attempts=0,pin_locked_until=0 WHERE id=?', [userId]);
      return u.pin_hash;
    } finally {
      release();
      if (locks.get(userId) === next) locks.delete(userId);
    }
  }
  function ticketGrant(user, ticket, session) {
    const payload = Buffer.from(JSON.stringify({ u: user.id, t: Number(ticket), exp: Date.now() + 120000, s: digest(session), v: digest(user.pin_hash) })).toString('base64url');
    return payload + '.' + digest(payload);
  }
  function checkTicketGrant(token, user, ticket, session) {
    try {
      const [payload, signature, extra] = String(token || '').split('.');
      if (extra || !equal(digest(payload), signature)) throw new Error();
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (!user.pin_hash || data.u !== user.id || data.t !== Number(ticket) || data.exp <= Date.now() || data.s !== digest(session) || data.v !== digest(user.pin_hash)) throw new Error();
    } catch { throw fail('Nhập mã bảo mật để mở mã QR của vé này.', 403); }
  }
  return { credentials, verify, ticketGrant, checkTicketGrant };
};
