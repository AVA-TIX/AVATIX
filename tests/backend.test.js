const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB = ':memory:';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.BREVO_API_KEY = '';
process.env.TURSO_DATABASE_URL = '';
process.env.TURSO_AUTH_TOKEN = '';
const { app, db } = require('../server');
const mailer = require('../mailer');
const sharp = require('sharp');

test('account avatar and email-only OTP API', async t => {
  await db.migrate();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/';
  let cookie = '';
  const request = async (url, body, authenticated = true) => {
    const response = await fetch(base + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const login = async (username, password = 'Demo@2025') => {
    const response = await request('login', { username, password });
    assert.equal(response.status, 200);
    cookie = response.cookie;
  };
  const assertNoCode = body => {
    for (const key of ['code', 'devOtp', 'otp']) assert.equal(Object.hasOwn(body, key), false);
    assert.notEqual(body.mode, 'dev');
  };
  const originalSend = mailer.sendOtpEmail, originalConfigured = mailer.isSmtpConfigured;
  try {
    await login('demo_customer');
    const originalMe = (await request('me')).body;
    await t.test('rejects unauthenticated and unsafe avatar data', async () => {
      assert.equal((await request('profile/avatar', { avatar: null }, false)).status, 401);
      for (const avatar of [undefined, 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'), 'data:image/png;base64,YmFk', 'javascript:alert(1)']) {
        assert.equal((await request('profile/avatar', { avatar })).status, 400);
      }
      const oversized = 'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');
      assert.equal((await request('profile/avatar', { avatar: oversized })).status, 400);
    });
    await t.test('normalizes avatar and persists across sessions, isolated to its owner', async () => {
      const image = await sharp({ create: { width: 320, height: 200, channels: 4, background: '#e84142' } }).png().toBuffer();
      const saved = await request('profile/avatar', { avatar: 'data:image/png;base64,' + image.toString('base64') });
      assert.equal(saved.status, 200);
      assert.match(saved.body.avatar, /^data:image\/webp;base64,/);
      const meta = await sharp(Buffer.from(saved.body.avatar.split(',')[1], 'base64')).metadata();
      assert.equal(meta.width, 512);
      assert.equal(meta.height, 512);
      await login('demo_customer');
      assert.equal((await request('me')).body.avatar, saved.body.avatar);
      await login('demo_organizer');
      assert.equal((await request('me')).body.avatar, null);
      await login('demo_customer');
      assert.equal((await request('profile/avatar', { avatar: null })).body.avatar, null);
      assert.equal((await request('me')).body.avatar, null);
      assert.equal((await request('me')).body.balance, originalMe.balance);
    });
    await t.test('converts TIFF for the browser cropper and rejects nonimages', async () => {
      const image = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#e84142' } }).tiff().toBuffer();
      const prepared = await request('profile/avatar/prepare', { image: 'data:image/tiff;base64,' + image.toString('base64') });
      assert.equal(prepared.status, 200);
      assert.match(prepared.body.image, /^data:image\/webp;base64,/);
      const meta = await sharp(Buffer.from(prepared.body.image.split(',')[1], 'base64')).metadata();
      assert.equal(meta.width, 30);
      assert.equal(meta.height, 20);
      assert.equal((await request('profile/avatar/prepare', { image: 'data:image/tiff;base64,YmFk' })).status, 400);
      assert.equal((await request('profile/avatar/prepare', { image: 'data:image/tiff;base64,YmFk' }, false)).status, 401);
    });
    let otpUser;
    await t.test('missing SMTP never exposes a code or creates a usable OTP', async () => {
      const registered = await request('register', { username: 'otp_tester', password: 'Testpass1', pin: '034678', pinConfirmation: '034678', email: 'recipient@gmail.com', phone: '0905550201', bank: 'VCB - 1234567890', role: 'customer' });
      assert.equal(registered.status, 200);
      assert.match(registered.body.otpError, /chưa được cấu hình/);
      assertNoCode(registered.body);
      otpUser = await db.get('SELECT * FROM users WHERE username=?', ['otp_tester']);
      for (const [url, body] of [['verify-email/request', { username: 'otp_tester' }], ['forgot-password/request', { identifier: 'otp_tester' }], ['buy/request-otp', {}]]) {
        const response = await request(url, body, url === 'buy/request-otp');
        assert.equal(response.status, 503);
        assertNoCode(response.body);
      }
      assert.equal((await db.get('SELECT COUNT(*) n FROM otps')).n, 0);
    });
    const sent = [];
    mailer.isSmtpConfigured = () => true;
    mailer.sendOtpEmail = async message => { sent.push(message); return { mode: 'smtp' }; };
    await t.test('delivers to account email, stores only a hash and consumes OTP', async () => {
      const response = await request('verify-email/request', { username: 'otp_tester' }, false);
      assert.equal(response.status, 200);
      assertNoCode(response.body);
      assert.equal(sent.at(-1).to, 'recipient@gmail.com');
      const code = sent.at(-1).code;
      const row = await db.get('SELECT * FROM otps WHERE user_id=? AND used=0', [otpUser.id]);
      assert.notEqual(row.code_hash, code);
      assert.equal(row.code_hash.length, 64);
      assert.equal((await request('verify-email/request', { username: 'otp_tester' }, false)).status, 429);
      assert.equal((await request('verify-email/confirm', { username: 'otp_tester', code }, false)).status, 200);
      assert.equal((await db.get('SELECT email_verified FROM users WHERE id=?', [otpUser.id])).email_verified, 1);
      assert.equal((await db.get('SELECT used FROM otps WHERE id=?', [row.id])).used, 1);
    });
    await t.test('failed delivery cannot be verified and permits immediate retry', async () => {
      mailer.sendOtpEmail = async () => { throw Object.assign(new Error('Email temporarily unavailable'), { c: 503 }); };
      const failed = await request('forgot-password/request', { identifier: 'otp_tester' }, false);
      assert.equal(failed.status, 503);
      assertNoCode(failed.body);
      assert.equal((await db.get("SELECT COUNT(*) n FROM otps WHERE user_id=? AND purpose='reset_password' AND used=0", [otpUser.id])).n, 0);
      mailer.sendOtpEmail = async message => { sent.push(message); return { mode: 'smtp' }; };
      assert.equal((await request('forgot-password/request', { identifier: 'otp_tester' }, false)).status, 200);
      const rightCode = sent.at(-1).code;
      const wrongCode = rightCode === '111111' ? '222222' : '111111';
      for (let i = 0; i < 5; i++) assert.equal((await request('forgot-password/confirm', { identifier: 'otp_tester', code: wrongCode, newPassword: 'Newpass1' }, false)).status, 400);
      assert.equal((await request('forgot-password/confirm', { identifier: 'otp_tester', code: rightCode, newPassword: 'Newpass1' }, false)).status, 400);
    });
    await t.test('expired codes fail and a delivered code is consumed only once', async () => {
      await request('forgot-password/request', { identifier: 'otp_tester' }, false);
      const expiredCode = sent.at(-1).code;
      await db.run("UPDATE otps SET expires_at=0 WHERE user_id=? AND purpose='reset_password' AND used=0", [otpUser.id]);
      assert.equal((await request('forgot-password/confirm', { identifier: 'otp_tester', code: expiredCode, newPassword: 'Newpass1' }, false)).status, 400);
      await request('forgot-password/request', { identifier: 'otp_tester' }, false);
      const code = sent.at(-1).code;
      const responses = await Promise.all([
        request('forgot-password/confirm', { identifier: 'otp_tester', code, newPassword: 'Newpass1' }, false),
        request('forgot-password/confirm', { identifier: 'otp_tester', code, newPassword: 'Newpass2' }, false)
      ]);
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
      assert.equal((await request('forgot-password/confirm', { identifier: 'otp_tester', code, newPassword: 'Newpass3' }, false)).status, 400);
    });
    await t.test('DEMO_OTP_BYPASS applies strictly to demo accounts when enabled', async () => {
      const prevBypass = process.env.DEMO_OTP_BYPASS;
      try {
        delete process.env.DEMO_OTP_BYPASS;
        await login('demo_customer');
        assert.equal((await request('me')).body.demoOtpBypass, false);
        assert.equal((await request('buy', { event: 1 })).status, 400);

        process.env.DEMO_OTP_BYPASS = '1';
        assert.equal((await request('me')).body.demoOtpBypass, true);
        const bypassReq = await request('buy/request-otp', {});
        assert.equal(bypassReq.status, 200);
        assert.equal(bypassReq.body.bypass, true);
        assert.equal((await request('buy', { event: 1 })).status, 200);

        // Real registered user still cannot bypass OTP even when DEMO_OTP_BYPASS=1
        assert.equal((await request('register', { username: 'real_user_check', password: 'Testpass1', pin: '246810', pinConfirmation: '246810', email: 'realcheck@example.com', phone: '0905550299', bank: 'VCB - 1234567890', role: 'customer' }, false)).status, 200);
        await login('real_user_check', 'Testpass1');
        assert.equal((await request('me')).body.demoOtpBypass, false);
        assert.equal((await request('buy', { event: 1 })).status, 400);
      } finally {
        prevBypass === undefined ? delete process.env.DEMO_OTP_BYPASS : (process.env.DEMO_OTP_BYPASS = prevBypass);
      }
    });
    await t.test('admin overview, masked PII, organizer approval, and violating show cancellation', async () => {
      const prevAdminUser = process.env.ADMIN_USER, prevAdminPass = process.env.ADMIN_PASS;
      process.env.ADMIN_USER = 'avatix_admin_test';
      process.env.ADMIN_PASS = 'AdminTest1';
      await db.migrate();
      try {
        await login('demo_customer');
        assert.equal((await request('admin/overview')).status, 403);
        const regOrg = await request('register', { username: 'pending_btc_1', password: 'OrgPass1', pin: '135790', pinConfirmation: '135790', email: 'pending.btc@gmail.com', phone: '0905550888', bank: 'VCB - 1234567890', role: 'organizer', cccd: '079099123456' }, false);
        assert.equal(regOrg.status, 200);
        const orgRes = await request('login', { username: 'pending_btc_1', password: 'OrgPass1' }, false);
        const orgCookie = orgRes.cookie;
        const callAs = async (url, body, c) => {
          const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: c }, body: body === undefined ? undefined : JSON.stringify(body) });
          return { status: r.status, body: await r.json() };
        };
        assert.equal((await callAs('events', { name: 'Pending Blocked', date: '2027-06-01', venue: 'HCM', price: 100000, total: 10 }, orgCookie)).status, 403);

        const adminLogin = await request('login', { username: 'avatix_admin_test', password: 'AdminTest1' }, false);
        assert.equal(adminLogin.status, 200);
        const adminCookie = adminLogin.cookie;
        const list = await callAs('admin/users', undefined, adminCookie);
        const target = list.body.find(u => u.username === 'pending_btc_1');
        assert.equal(target.email, 'pe***@gmail.com');
        assert.equal(target.phone, '090****888');
        assert.equal(target.cccd, '********3456');
        assert.equal(target.bank, 'VCB - ****7890');
        assert.equal((await callAs(`admin/users/${target.id}/status`, { status: 'active' }, adminCookie)).status, 200);
        assert.equal((await callAs('events', { name: 'Violating Show', date: '2027-06-01', venue: 'HCM', price: 200000, total: 10 }, orgCookie)).status, 200);

        const evRow = await db.get("SELECT id FROM events WHERE name='Violating Show'");
        const custBefore = (await db.get("SELECT balance FROM users WHERE username='demo_customer'")).balance;
        process.env.DEMO_OTP_BYPASS = '1';
        await login('demo_customer');
        assert.equal((await request('buy', { event: evRow.id })).status, 200);
        const cancelRes = await callAs(`admin/events/${evRow.id}/cancel`, {}, adminCookie);
        assert.equal(cancelRes.status, 200);
        assert.equal(cancelRes.body.refundedTickets, 1);
        assert.equal(cancelRes.body.totalRefund, 200000);
        assert.equal((await db.get("SELECT balance FROM users WHERE username='demo_customer'")).balance, custBefore);
        assert.equal((await db.get('SELECT status FROM events WHERE id=?', [evRow.id])).status, 'cancelled');

        // Past events cannot be cancelled by admin or organizer
        const pastIns = await db.run("INSERT INTO events(org,name,date,venue,price,total,remain,status) VALUES(?,'Past Event','2026-01-01','HCM',100000,10,10,'active')", [target.id]);
        assert.equal((await callAs(`admin/events/${pastIns.lastInsertRowid}/cancel`, {}, adminCookie)).status, 400);
      } finally {
        delete process.env.DEMO_OTP_BYPASS;
        prevAdminUser === undefined ? delete process.env.ADMIN_USER : (process.env.ADMIN_USER = prevAdminUser);
        prevAdminPass === undefined ? delete process.env.ADMIN_PASS : (process.env.ADMIN_PASS = prevAdminPass);
      }
    });
  } finally {
    mailer.sendOtpEmail = originalSend;
    mailer.isSmtpConfigured = originalConfigured;
    await new Promise(resolve => server.close(resolve));
  }
});
