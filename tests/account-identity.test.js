const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB = ':memory:';
process.env.TURSO_DATABASE_URL = process.env.TURSO_AUTH_TOKEN = '';
process.env.SMTP_USER = process.env.SMTP_PASS = process.env.BREVO_API_KEY = '';
const { app, db } = require('../server');

test('one email and phone per account, including concurrent registrations and old databases', async t => {
  // A pre-existing database can contain duplicates. Migration must preserve it.
  await db.run('CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE,hash TEXT,salt TEXT,email TEXT,phone TEXT,bank TEXT,role TEXT,balance INTEGER DEFAULT 0,cccd TEXT)');
  await db.run("INSERT INTO users(id,username,email,phone) VALUES(100,'legacy_one','Legacy@example.com','0905550001'),(101,'legacy_two','legacy@example.com','0905550001')");
  await db.migrate();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const profile = { password: 'ExamplePass1', pin: '043682', pinConfirmation: '043682', bank: 'VCB - 123456789', role: 'customer' };
  const signup = async body => {
    const response = await fetch(base + 'register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...profile, ...body }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    await t.test('normalizes email case and whitespace, rejects duplicate email or phone', async () => {
      assert.equal((await signup({ username: 'unique_first', email: '  Person@GMAIL.COM  ', phone: '0905550301' })).status, 200);
      const saved = await db.get("SELECT email FROM users WHERE username='unique_first'");
      assert.equal(saved.email, 'person@gmail.com');
      const email = await signup({ username: 'unique_second', email: 'PERSON@gmail.com', phone: '0905550302' });
      assert.equal(email.status, 409);assert.match(email.body.e, /Email đã được sử dụng/);
      const phone = await signup({ username: 'unique_third', email: 'other@example.com', phone: ' 0905550301 ' });
      assert.equal(phone.status, 409);assert.match(phone.body.e, /Số điện thoại đã được sử dụng/);
      assert.equal((await db.get("SELECT COUNT(*) n FROM users WHERE username IN ('unique_second','unique_third')")).n, 0);
    });
    await t.test('simultaneous requests cannot claim the same email or phone twice', async () => {
      for (const contact of ['email', 'phone']) {
        const results = await Promise.all([0, 1].map(i => signup({ username: `parallel_${contact}_${i}`, email: contact === 'email' ? 'parallel@example.com' : `phone${i}@example.com`, phone: contact === 'phone' ? '0905550401' : `090555050${i}` })));
        assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      }
    });
    await t.test('database also protects direct inserts and contact updates', async () => {
      await assert.rejects(db.run("INSERT INTO users(username,email,phone) VALUES('direct_email',' PERSON@gmail.com ','0905550601')"), /EMAIL_ALREADY_USED/);
      await assert.rejects(db.run("INSERT INTO users(username,email,phone) VALUES('direct_phone','direct@example.com','0905550301')"), /PHONE_ALREADY_USED/);
      await assert.rejects(db.run("UPDATE users SET email='person@gmail.com' WHERE username='demo_customer'"), /EMAIL_ALREADY_USED/);
      await assert.rejects(db.run("UPDATE users SET phone='0905550301' WHERE username='demo_customer'"), /PHONE_ALREADY_USED/);
    });
    await t.test('migration preserves old duplicates while preventing new claims and double verification', async () => {
      await db.migrate();
      assert.equal((await db.get("SELECT COUNT(*) n FROM users WHERE id IN (100,101)")).n, 2);
      assert.equal((await signup({ username: 'legacy_third', email: 'legacy@example.com', phone: '0905550701' })).status, 409);
      await db.run('UPDATE users SET email_verified=1 WHERE id=100');
      await assert.rejects(db.run('UPDATE users SET email_verified=1 WHERE id=101'), /EMAIL_ALREADY_USED/);
      assert.equal((await db.get('SELECT email_verified FROM users WHERE id=101')).email_verified, 0);
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
