const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

const testTransporter = async () => {
  try {
    await getTransporter().verify();
  } catch (err) {
    throw new Error(`Email service unavailable. Check SMTP credentials. (${err.message})`);
  }
};

const sendOTPEmail = async (email, otp) => {
  const fromName = process.env.FROM_NAME || 'Garage Sale';
  const fromEmail = process.env.FROM_EMAIL || 'noreply@garagesale.com';

  await getTransporter().sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject: 'Your Password Reset OTP - Garage Sale',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #2EAD4A, #72D97D); padding: 30px; border-radius: 16px; text-align: center; margin-bottom: 24px;">
          <h1 style="color: #fff; margin: 0; font-size: 28px;">🏷️ Garage Sale</h1>
        </div>
        <h2 style="color: #111; font-size: 22px;">Password Reset Request</h2>
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          You requested to reset your password. Use the OTP code below:
        </p>
        <div style="background: #f5f6fa; border: 2px dashed #2EAD4A; border-radius: 12px; padding: 28px; text-align: center; margin: 24px 0;">
          <span style="font-size: 42px; font-weight: 900; letter-spacing: 14px; color: #2EAD4A;">${otp}</span>
        </div>
        <p style="color: #777; font-size: 14px;">
          This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
        </p>
        <p style="color: #999; font-size: 13px; margin-top: 32px;">
          If you did not request this, please ignore this email.
        </p>
      </div>
    `,
  });

  logger.info(`OTP email sent to ${email}`);
};

const sendRegistrationOTPEmail = async (email, otp) => {
  const fromName = process.env.FROM_NAME || 'Garage Sale';
  const fromEmail = process.env.FROM_EMAIL || 'noreply@garagesale.com';

  await getTransporter().sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject: 'Verify your email — Garage Sale',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #2EAD4A, #72D97D); padding: 30px; border-radius: 16px; text-align: center; margin-bottom: 24px;">
          <h1 style="color: #fff; margin: 0; font-size: 28px;">🏷️ Garage Sale</h1>
        </div>
        <h2 style="color: #111; font-size: 22px;">Verify your email address</h2>
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          You're almost there! Enter the verification code below to complete your registration.
        </p>
        <div style="background: #f5f6fa; border: 2px dashed #2EAD4A; border-radius: 12px; padding: 28px; text-align: center; margin: 24px 0;">
          <span style="font-size: 42px; font-weight: 900; letter-spacing: 14px; color: #2EAD4A;">${otp}</span>
        </div>
        <p style="color: #777; font-size: 14px;">
          This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
        </p>
        <p style="color: #999; font-size: 13px; margin-top: 32px;">
          If you did not create an account, please ignore this email.
        </p>
      </div>
    `,
  });

  logger.info(`Registration OTP email sent to ${email}`);
};

module.exports = { sendOTPEmail, sendRegistrationOTPEmail, testTransporter };
