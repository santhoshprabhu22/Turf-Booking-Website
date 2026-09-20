import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { db } from './db.js';

const OTP_EXPIRY_MINUTES = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_OTP_PER_WINDOW = 5;

function hashOTP(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Send OTP email via Gmail SMTP ───────────────────────────────────────────
async function sendOTPEmail(toEmail, otp) {
  const emailFrom    = process.env.EMAIL_FROM;
  const emailPass    = process.env.EMAIL_APP_PASSWORD;

  // If credentials are not set yet, fall back to sandbox mode
  if (!emailFrom || !emailPass || emailFrom.trim() === '' || emailPass.trim() === '') {
    return { success: false, sandbox: true };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: emailFrom.trim(),
      pass: emailPass.trim()
    }
  });

  const mailOptions = {
    from: `"Santhosh Turf" <${emailFrom.trim()}>`,
    to: toEmail,
    subject: `${otp} is your Santhosh Turf OTP`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;padding:32px;background:#0d1117;color:#fff;border-radius:14px;">
        <h2 style="color:#1ad953;margin-bottom:4px;">Santhosh Turf</h2>
        <p style="color:#888;margin-top:0;font-size:0.85rem;">Slot Booking Verification</p>
        <hr style="border-color:#222;margin:20px 0;" />
        <p style="font-size:1rem;">Your one-time verification code is:</p>
        <div style="background:#161b22;border:2px solid #1ad953;border-radius:12px;padding:28px;text-align:center;margin:24px 0;">
          <span style="font-size:2.8rem;font-weight:900;letter-spacing:0.35em;color:#1ad953;font-family:monospace;">${otp}</span>
        </div>
        <p style="color:#888;font-size:0.82rem;">
          ⏱ This code expires in <strong style="color:#fff">${OTP_EXPIRY_MINUTES} minutes</strong>.<br/>
          Do <strong>not</strong> share it with anyone.
        </p>
        <hr style="border-color:#222;margin:20px 0;" />
        <p style="color:#444;font-size:0.72rem;">© 2026 Santhosh Turf · If you didn't request this, ignore this email.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email OTP] ✅ Sent to ${toEmail}`);
    return { success: true };
  } catch (err) {
    console.error(`[Email OTP] ❌ Failed to send to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── Main OTP Service (Email-based) ──────────────────────────────────────────
export class SMSService {

  /**
   * sendOTP — generates a 6-digit OTP and sends it to the given email address.
   * Falls back to sandbox mode (returns OTP in response) if email not configured.
   */
  static async sendOTP(email) {
    if (!email || !email.includes('@')) {
      return { success: false, message: 'Please enter a valid email address.' };
    }

    const now = Date.now();

    // Rate limiting — max 5 OTPs per email per hour
    const otps = await db.getCollection('otps');
    const recent = otps.filter(
      item => item.email === email &&
              (now - new Date(item.createdAt || 0).getTime()) < RATE_LIMIT_WINDOW_MS
    );
    if (recent.length >= MAX_OTP_PER_WINDOW) {
      return { success: false, message: 'Too many OTP requests. Please try again after 1 hour.' };
    }

    const otp       = generateOTP();
    const otpHash   = hashOTP(otp);
    const expiresAt = now + OTP_EXPIRY_MINUTES * 60 * 1000;

    // Invalidate any old unverified OTPs for this email
    await db.delete('otps', item => item.email === email && item.verified === false);
    await db.insert('otps', {
      email,
      hash: otpHash,
      expiresAt,
      verified: false,
      createdAt: new Date().toISOString()
    });

    // Always log to server console for debugging
    console.log(`\n========================================`);
    console.log(`[OTP] Email: ${email}  |  OTP: ${otp}`);
    console.log(`Expires in ${OTP_EXPIRY_MINUTES} minutes.`);
    console.log(`========================================\n`);

    // Try to send the email
    const result = await sendOTPEmail(email, otp);

    if (result.success) {
      return { success: true, message: `OTP sent to ${email}` };
    }

    if (result.sandbox) {
      // Email credentials not configured yet — return OTP in response for testing
      return {
        success: true,
        message: 'Sandbox mode — email not configured',
        otp // Only returned in sandbox mode; removed once EMAIL_FROM is set
      };
    }

    return {
      success: false,
      message: `Could not send email: ${result.error}. Check EMAIL_FROM and EMAIL_APP_PASSWORD in .env`
    };
  }

  /**
   * verifyOTP — checks the OTP against the stored hash for the given email.
   */
  static async verifyOTP(email, otp) {
    const now = Date.now();

    const otpRecord = await db.findOne('otps', item =>
      item.email === email &&
      item.verified === false &&
      item.expiresAt > now
    );

    if (!otpRecord) {
      return { success: false, message: 'OTP expired or not found. Please request a new one.' };
    }

    const inputHash = hashOTP(otp.toString().trim());
    if (otpRecord.hash !== inputHash) {
      return { success: false, message: 'Incorrect OTP. Please try again.' };
    }

    await db.update('otps', otpRecord.id, { verified: true });
    return { success: true };
  }
}
