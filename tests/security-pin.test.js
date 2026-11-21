const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.DB = ':memory:';
process.env.SECRET = 'pin-integration-test-secret-only';
process.env.TURSO_DATABASE_URL = process.env.TURSO_AUTH_TOKEN = '';
process.env.SMTP_USER = process.env.SMTP_PASS = '';
process.env.BREVO_API_KEY = '';
const { app, db } = require('../server');
const mailer = require('../mailer');

test('six-digit security PIN and protected ticket access', async t => {
  await db.migrate();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  let cookie = '';
  const request = async (path, body, extra = {}) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const profile = { username: 'pin_test_user', password: 'ExamplePass1', pin: '043682', pinConfirmation: '043682', email: 'pin-test@example.com', phone: '0901234567', bank: 'VCB - 123456789', role: 'customer' };
  const login = async (pin = '043682') => {
    const result = await request('login', { username: profile.username, password: profile.password, pin });
    assert.equal(result.status, 200);
    assert.ok(result.cookie);
    cookie = result.cookie;
    return cookie;
  };
  const send = mailer.sendOtpEmail, configured = mailer.isSmtpConfigured;
  try {
    await t.test('registration requires six digits and matching confirmation', async () => {
      for (const invalid of [{ pin: undefined }, { pin: '12345' }, { pin: 123456 }, { pin: 'abcdef' }, { pinConfirmation: '999999' }]) {
        assert.equal((await request('register', { ...profile, ...invalid })).status, 422);
      }
      assert.equal((await request('register', profile)).status, 200);
      const user = await db.get('SELECT * FROM users WHERE username=?', [profile.username]);
      assert.notEqual(user.pin_hash, profile.pin);
      assert.ok(user.pin_salt);
    });
    await t.test('password alone cannot create a session for a PIN-protected account', async () => {
      const result = await request('login', { username: profile.username, password: profile.password });
      assert.equal(result.body.pinRequired, true);
      assert.equal(result.cookie, undefined);
      assert.equal((await request('login', { username: profile.username, password: profile.password, pin: '999999' })).status, 422);
      await login();
      const me = (await request('me')).body;
      assert.equal(me.pinConfigured, true);
      for (const field of ['pin_hash', 'pin_salt', 'pin_attempts', 'pin_locked_until', 'hash', 'salt', 'session_desktop', 'session_mobile']) assert.equal(Object.hasOwn(me, field), false);
      assert.deepEqual((await request('security/pin/verify', { pin: profile.pin })).body, { ok: 1 });
    });
    const user = await db.get('SELECT * FROM users WHERE username=?', [profile.username]);
    await db.run('INSERT INTO tickets(event,owner,orig,used) VALUES(1,?,150000,0)', [user.id]);
    await db.run('INSERT INTO tickets(event,owner,orig,used) VALUES(1,?,150000,0)', [user.id]);
    const tickets = await db.all('SELECT id FROM tickets WHERE owner=?', [user.id]);
    const path = `qr/${tickets[0].id}`;
    let grant;
    await t.test('QR API cannot be bypassed and grants are scoped to one ticket', async () => {
      assert.equal((await request(path)).status, 403);
      assert.equal((await request(path + '/unlock', { pin: '999999' })).status, 422);
      const unlocked = await request(path + '/unlock', { pin: profile.pin });
      assert.equal(unlocked.status, 200);
      grant = unlocked.body.unlockToken;
      const response = await request(path, undefined, { 'X-Ticket-Unlock': grant });
      assert.equal(response.status, 200);
      assert.match(response.body.svg, /<svg/);
      assert.equal((await request(`qr/${tickets[1].id}`, undefined, { 'X-Ticket-Unlock': grant })).status, 403);
      assert.equal((await request(path, undefined, { 'X-Ticket-Unlock': grant + 'x' })).status, 403);
      const parts = grant.split('.');
      const data = JSON.parse(Buffer.from(parts[0], 'base64url'));data.exp = Date.now() - 1;
      const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
      const expired = payload + '.' + crypto.createHmac('sha256', process.env.SECRET).update(payload).digest('hex');
      assert.equal((await request(path, undefined, { 'X-Ticket-Unlock': expired })).status, 403);
    });
    await t.test('QR unlock cannot be reused from another login or by another owner', async () => {
      await login();
      assert.equal((await request(path, undefined, { 'X-Ticket-Unlock': grant })).status, 403);
      const other = await request('login', { username: 'demo_organizer', password: 'Demo@2025' });
      cookie = other.cookie;
      assert.equal((await request(path + '/unlock', { pin: profile.pin })).status, 403);
      await login();
    });
    await t.test('changing PIN requires password plus old PIN and revokes QR grants', async () => {
      grant = (await request(path + '/unlock', { pin: profile.pin })).body.unlockToken;
      const body = { currentPassword: profile.password, oldPin: profile.pin, pin: '057924', pinConfirmation: '057924' };
      assert.equal((await request('security/pin/change', { ...body, currentPassword: 'wrong' })).status, 422);
      assert.equal((await request('security/pin/change', { ...body, oldPin: '000000' })).status, 422);
      assert.equal((await request('security/pin/change', body)).status, 200);
      assert.equal((await request(path, undefined, { 'X-Ticket-Unlock': grant })).status, 403);
      assert.equal((await request('security/pin/verify', { pin: profile.pin })).status, 422);
      assert.equal((await request('security/pin/verify', { pin: body.pin })).status, 200);
    });
    await t.test('parallel wrong attempts lock the account and the lock survives new sessions', async () => {
      const responses = await Promise.all(Array.from({ length: 6 }, () => request('security/pin/verify', { pin: '999999' })));
      assert.ok(responses.some(r => r.status === 429));
      assert.equal((await request('security/pin/verify', { pin: '057924' })).status, 429);
      const row = await db.get('SELECT pin_attempts,pin_locked_until FROM users WHERE id=?', [user.id]);
      assert.equal(row.pin_attempts, 5);
      assert.ok(row.pin_locked_until > Date.now());
      cookie = '';
      assert.equal((await request('login', { username: profile.username, password: profile.password, pin: '057924' })).status, 429);
      await db.run('UPDATE users SET pin_locked_until=? WHERE id=?', [Date.now() - 1, user.id]);
      await login('057924');
    });
    await t.test('PIN recovery requires password and real email OTP, including when logged out', async () => {
      await db.run('UPDATE users SET email_verified=1 WHERE id=?', [user.id]);
      cookie = '';
      const body = { identifier: profile.username, currentPassword: profile.password };
      assert.equal((await request('security/pin/reset/request', body)).status, 503);
      let delivered;
      mailer.isSmtpConfigured = () => true;
      mailer.sendOtpEmail = async value => { delivered = value; return { mode: 'smtp' }; };
      assert.equal((await request('security/pin/reset/request', { ...body, currentPassword: 'wrong' })).status, 422);
      const requested = await request('security/pin/reset/request', body);
      assert.equal(requested.status, 200);
      assert.equal(delivered.purpose, 'reset_pin');assert.equal(delivered.to, profile.email);
      assert.equal(Object.hasOwn(requested.body, 'devOtp'), false);
      const reset = { ...body, code: delivered.code, pin: '006532', pinConfirmation: '006532' };
      assert.equal((await request('security/pin/reset/confirm', { ...reset, code: 'abcdef' })).status, 400);
      assert.equal((await request('security/pin/reset/confirm', reset)).status, 200);
      assert.equal((await request('security/pin/reset/confirm', reset)).status, 400);
      await login('006532');
    });
    await t.test('legacy users choose their own PIN and cannot overwrite an existing one', async () => {
      cookie = (await request('login', { username: 'demo_customer', password: 'Demo@2025' })).cookie;
      assert.equal((await request('me')).body.pinConfigured, false);
      const body = { currentPassword: 'Demo@2025', pin: '004123', pinConfirmation: '004123' };
      assert.equal((await request('security/pin/setup', { ...body, currentPassword: 'wrong' })).status, 422);
      assert.equal((await request('security/pin/setup', body)).status, 200);
      assert.equal((await request('security/pin/setup', body)).status, 409);
      cookie = '';
      assert.equal((await request('security/pin/setup', body)).status, 401);
    });
  } finally {
    mailer.sendOtpEmail = send;mailer.isSmtpConfigured = configured;
    await new Promise(resolve => server.close(resolve));
  }
});
