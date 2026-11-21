const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const mailer = require('../mailer');

test('SMTP mailer sends only real mail and never falls back to display codes', async t => {
  const originalTransport = nodemailer.createTransport;
  const originalFetch = global.fetch;
  const envKeys = ['BREVO_API_KEY', 'MAIL_FROM_EMAIL', 'MAIL_FROM_NAME', 'SMTP_USER', 'SMTP_PASS', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_FROM'];
  const before = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const message = { to: 'recipient@gmail.com', username: '<img src=x onerror=alert(1)>', code: '123456', purpose: 'verify_email' };
  const sent = [];
  let transportOptions;
  const setup = pass => {
    delete process.env.BREVO_API_KEY;
    delete process.env.MAIL_FROM_EMAIL;
    delete process.env.MAIL_FROM_NAME;
    process.env.SMTP_USER = 'system@gmail.com'; process.env.SMTP_PASS = pass;
    process.env.SMTP_HOST = 'smtp.gmail.com'; process.env.SMTP_PORT = '465'; process.env.SMTP_SECURE = 'true';
    delete process.env.SMTP_FROM;
  };
  try {
    await t.test('requires credentials', async () => {
      setup('');
      assert.equal(mailer.isSmtpConfigured(), false);
      await assert.rejects(mailer.sendOtpEmail(message), error => error.c === 503 && !error.message.includes('123456'));
    });
    await t.test('uses registered recipient, escapes username and requires TLS', async () => {
      setup('test-app-password');
      nodemailer.createTransport = options => {
        transportOptions = options;
        return { sendMail: async mail => { sent.push(mail); return { accepted: [mail.to] }; } };
      };
      assert.deepEqual(await mailer.sendOtpEmail(message), { mode: 'smtp' });
      assert.equal(transportOptions.host, 'smtp.gmail.com');
      assert.equal(transportOptions.secure, true);
      assert.equal(transportOptions.tls.minVersion, 'TLSv1.2');
      assert.equal(sent[0].to, message.to);
      assert.equal(sent[0].from, '"AVA-TIX Security" <system@gmail.com>');
      assert.match(sent[0].html, /&lt;img/);
      assert.doesNotMatch(sent[0].html, /<img/);
      assert.match(sent[0].text, /123456/);
    });
    await t.test('sanitizes SMTP failure and recipient rejection', async () => {
      setup('another-test-password');
      nodemailer.createTransport = () => ({ sendMail: async () => { throw new Error('password=secret OTP=123456'); } });
      await assert.rejects(mailer.sendOtpEmail(message), error => error.c === 503 && !/secret|123456/.test(error.message));
      setup('third-test-password');
      nodemailer.createTransport = () => ({ sendMail: async () => ({ accepted: [], rejected: [message.to] }) });
      await assert.rejects(mailer.sendOtpEmail(message), error => error.c === 503);
    });
    await t.test('sends via Brevo HTTPS API and sanitizes failures', async () => {
      setup('');
      process.env.BREVO_API_KEY = 'xkeysib-test-secret';
      process.env.MAIL_FROM_EMAIL = 'sender@gmail.com';
      process.env.MAIL_FROM_NAME = 'AVA-TIX Security';
      assert.equal(mailer.isBrevoConfigured(), true);
      assert.equal(mailer.isSmtpConfigured(), true);
      let calledUrl = '', calledOpts = null;
      global.fetch = async (url, opts) => {
        calledUrl = url;
        calledOpts = opts;
        return { ok: true, status: 201 };
      };
      assert.deepEqual(await mailer.sendOtpEmail(message), { mode: 'brevo' });
      assert.equal(calledUrl, 'https://api.brevo.com/v3/smtp/email');
      assert.equal(calledOpts.headers['api-key'], 'xkeysib-test-secret');
      const payload = JSON.parse(calledOpts.body);
      assert.equal(payload.sender.email, 'sender@gmail.com');
      assert.equal(payload.to[0].email, message.to);
      assert.match(payload.htmlContent, /&lt;img/);
      assert.doesNotMatch(payload.htmlContent, /<img/);
      global.fetch = async () => ({ ok: false, status: 401 });
      await assert.rejects(mailer.sendOtpEmail(message), error => error.c === 503 && !/xkeysib|123456/.test(error.message));
    });
  } finally {
    nodemailer.createTransport = originalTransport;
    global.fetch = originalFetch;
    for (const key of envKeys) before[key] === undefined ? delete process.env[key] : process.env[key] = before[key];
  }
});
