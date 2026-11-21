/**
 * OTP is sent only by a configured email provider (Brevo HTTPS API or SMTP).
 * Codes are never returned to clients or written to logs, including when email is unavailable.
 */

const nodemailer = require("nodemailer");

let transporter = null, transportKey = '';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const serviceError = message => Object.assign(new Error(message), { c: 503 });

function brevoConfig() {
  const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
  const apiKey = clean(process.env.BREVO_API_KEY);
  const fromEmail = clean(process.env.MAIL_FROM_EMAIL);
  const fromName = clean(process.env.MAIL_FROM_NAME) || 'AVA-TIX Security';
  return { apiKey, fromEmail, fromName };
}

function isBrevoConfigured() {
  const { apiKey, fromEmail } = brevoConfig();
  return Boolean(apiKey && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail));
}

function smtpConfig() {
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const host = process.env.SMTP_HOST || (/@(?:gmail|googlemail)\.com$/i.test(user) ? 'smtp.gmail.com' : '');
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
  return { user, pass, host, port, secure };
}

function isSmtpOnlyConfigured() {
  const { user, pass, host, port } = smtpConfig();
  return Boolean(user && pass && host && Number.isInteger(port) && port > 0 && port <= 65535);
}

function isSmtpConfigured() {
  return isBrevoConfigured() || isSmtpOnlyConfigured();
}

function getTransporter() {
  const { user, pass, host, port, secure } = smtpConfig();
  const nextKey = JSON.stringify([user, pass, host, port, secure]);
  if (transporter && transportKey === nextKey) return transporter;
  if (transporter?.close) transporter.close();

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: { minVersion: 'TLSv1.2' },
    auth: { user, pass },
  });
  transportKey = nextKey;
  return transporter;
}

const PURPOSE_META = {
  verify_email: {
    subject: "[AVA-TIX] Mã xác thực Email tài khoản",
    title: "Xác thực địa chỉ Email",
    desc: "Nhập mã OTP dưới đây để hoàn tất xác thực email cho tài khoản AVA-TIX của bạn.",
  },
  change_password: {
    subject: "[AVA-TIX] Mã xác nhận Đổi mật khẩu",
    title: "Xác nhận đổi mật khẩu",
    desc: "Bạn vừa yêu cầu đổi mật khẩu tài khoản AVA-TIX. Nhập mã OTP bên dưới để xác nhận.",
  },
  reset_password: {
    subject: "[AVA-TIX] Mã khôi phục mật khẩu",
    title: "Đặt lại mật khẩu",
    desc: "Bạn vừa yêu cầu khôi phục mật khẩu tài khoản AVA-TIX. Không chia sẻ mã này cho bất kỳ ai.",
  },
  buy_ticket: {
    subject: "[AVA-TIX] Mã OTP xác nhận mua vé",
    title: "Xác nhận thanh toán mua vé",
    desc: "Bạn đang thực hiện giao dịch mua vé trên AVA-TIX. Nhập mã OTP dưới đây để xác nhận thanh toán và nhận vé NFT.",
  },
};

/**
 * Gửi mã OTP 6 số tới email người dùng
 * @returns {Promise<{mode: 'brevo'|'smtp'}>}
 */
async function sendOtpEmail({ to, username, code, purpose }) {
  const meta = PURPOSE_META[purpose] || PURPOSE_META.verify_email;

  if (!isSmtpConfigured()) {
    throw serviceError('Dịch vụ gửi email chưa được cấu hình. Vui lòng liên hệ quản trị viên.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || '')) || !/^\d{6}$/.test(String(code || ''))) {
    throw serviceError('Không thể gửi mã xác thực tới địa chỉ email này.');
  }

  const text = `Xin chao ${username}, ma OTP cua ban la: ${code} (het han sau 5 phut).`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border-top:4px solid #e84142;background:#fff;color:#171717">
      <h2 style="margin:0 0 8px">AVA-TIX · ${meta.title}</h2>
      <p>Xin chào <b>${escapeHtml(username)}</b>,</p>
      <p>${meta.desc}</p>
      <div style="margin:20px 0;padding:16px;text-align:center;background:#fff;border:2px solid #1d2b3a;border-radius:10px;font-size:32px;font-weight:700;letter-spacing:8px">
        ${code}
      </div>
      <p style="font-size:14px;color:#555">Mã có hiệu lực trong <b>5 phút</b>. Nếu không phải bạn thực hiện, vui lòng bỏ qua email này.</p>
    </div>
  `;

  // Ưu tiên Brevo HTTPS API (cổng 443 — chạy ổn định trên Render Free)
  if (isBrevoConfigured()) {
    const { apiKey, fromEmail, fromName } = brevoConfig();
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: to, name: String(username || to) }],
          subject: meta.subject,
          htmlContent: html,
          textContent: text,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        const errInfo = await response.json?.().catch(() => null);
        console.error(`[Mailer][Brevo] HTTP ${response.status}${errInfo?.code ? ` (${errInfo.code})` : ''}`);
        throw new Error(`Brevo HTTP ${response.status}`);
      }
      return { mode: "brevo" };
    } catch {
      throw serviceError('Chưa gửi được email xác thực. Vui lòng thử lại sau hoặc liên hệ quản trị viên.');
    }
  }

  const from = process.env.SMTP_FROM || `"AVA-TIX Security" <${process.env.SMTP_USER}>`;
  try {
    const result = await getTransporter().sendMail({
      from,
      to,
      subject: meta.subject,
      text,
      html,
    });
    if (!result.accepted?.some(address => String(address).toLowerCase() === String(to).toLowerCase())) {
      throw new Error('Recipient rejected');
    }
  } catch {
    // SMTP errors can include connection credentials and message contents.
    throw serviceError('Chưa gửi được email xác thực. Vui lòng thử lại sau hoặc liên hệ quản trị viên.');
  }
  return { mode: "smtp" };
}

module.exports = { sendOtpEmail, isSmtpConfigured, isBrevoConfigured };
