/**
 * Tests for the sendEmail wrapper around Resend.
 *
 * Mocks the Resend client at the module boundary so no network call
 * happens. Asserts every branch of the success/error tree + that
 * every failure path Sentry-captures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getResendSpy, sentryCaptureSpy, sendSpy } = vi.hoisted(() => ({
  getResendSpy: vi.fn(),
  sentryCaptureSpy: vi.fn(),
  sendSpy: vi.fn(),
}));

vi.mock('@/lib/email/client', () => ({
  getResend: getResendSpy,
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: sentryCaptureSpy,
}));

import { sendEmail } from '@/lib/email/send';

const validContent = {
  to: 'parent@example.com',
  subject: "Iris's book is ready",
  html: '<p>html</p>',
  text: 'text',
};

describe('sendEmail', () => {
  const originalFrom = process.env.EMAIL_FROM;

  beforeEach(() => {
    getResendSpy.mockReset();
    sentryCaptureSpy.mockReset();
    sendSpy.mockReset();
    getResendSpy.mockReturnValue({ emails: { send: sendSpy } });
    process.env.EMAIL_FROM = originalFrom;
  });

  it('returns success with the Resend message id on happy path', async () => {
    sendSpy.mockResolvedValue({ data: { id: 'msg_abc' }, error: null });
    const res = await sendEmail(validContent);
    expect(res).toEqual({ success: true, messageId: 'msg_abc' });
    expect(sentryCaptureSpy).not.toHaveBeenCalled();
  });

  it('reads the from address from EMAIL_FROM env var', async () => {
    process.env.EMAIL_FROM = 'hello@tuatale.com.au';
    sendSpy.mockResolvedValue({ data: { id: 'msg_x' }, error: null });
    await sendEmail(validContent);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'hello@tuatale.com.au' }),
    );
  });

  it('falls back to onboarding@resend.dev when EMAIL_FROM is unset', async () => {
    delete process.env.EMAIL_FROM;
    sendSpy.mockResolvedValue({ data: { id: 'msg_x' }, error: null });
    await sendEmail(validContent);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'onboarding@resend.dev' }),
    );
  });

  it('falls back when EMAIL_FROM is whitespace-only', async () => {
    process.env.EMAIL_FROM = '   ';
    sendSpy.mockResolvedValue({ data: { id: 'msg_x' }, error: null });
    await sendEmail(validContent);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'onboarding@resend.dev' }),
    );
  });

  it('passes through the content fields to Resend', async () => {
    sendSpy.mockResolvedValue({ data: { id: 'msg_x' }, error: null });
    await sendEmail(validContent);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'parent@example.com',
        subject: "Iris's book is ready",
        html: '<p>html</p>',
        text: 'text',
      }),
    );
  });

  it('returns failure + Sentry-captures when Resend returns an error object', async () => {
    sendSpy.mockResolvedValue({
      data: null,
      error: { message: 'invalid recipient' },
    });
    const res = await sendEmail(validContent);
    expect(res).toEqual({ success: false, error: 'invalid recipient' });
    expect(sentryCaptureSpy).toHaveBeenCalledTimes(1);
    expect(sentryCaptureSpy.mock.calls[0]![0]!).toBeInstanceOf(Error);
    expect(sentryCaptureSpy.mock.calls[0]![1]!).toMatchObject({
      tags: { component: 'email-send' },
      extra: expect.objectContaining({
        to: 'parent@example.com',
        subject: "Iris's book is ready",
      }),
    });
  });

  it('returns failure when Resend returns null data and no error (defence-in-depth)', async () => {
    sendSpy.mockResolvedValue({ data: null, error: null });
    const res = await sendEmail(validContent);
    expect(res.success).toBe(false);
    expect(sentryCaptureSpy).toHaveBeenCalledTimes(1);
  });

  it('returns failure when Resend returns data without an id', async () => {
    sendSpy.mockResolvedValue({ data: {}, error: null });
    const res = await sendEmail(validContent);
    expect(res.success).toBe(false);
    expect(sentryCaptureSpy).toHaveBeenCalledTimes(1);
  });

  it('catches synchronous throws from getResend (RESEND_API_KEY unset)', async () => {
    getResendSpy.mockImplementation(() => {
      throw new Error('Missing RESEND_API_KEY');
    });
    const res = await sendEmail(validContent);
    expect(res).toEqual({ success: false, error: 'Missing RESEND_API_KEY' });
    expect(sentryCaptureSpy).toHaveBeenCalledTimes(1);
  });

  it('catches network throws from Resend SDK', async () => {
    sendSpy.mockRejectedValue(new Error('ECONNRESET'));
    const res = await sendEmail(validContent);
    expect(res).toEqual({ success: false, error: 'ECONNRESET' });
    expect(sentryCaptureSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to "Unknown send error" when the thrown value is not an Error', async () => {
    sendSpy.mockRejectedValue('not even an error');
    const res = await sendEmail(validContent);
    expect(res).toEqual({ success: false, error: 'Unknown send error' });
  });
});
