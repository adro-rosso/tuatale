/**
 * Tests for the ship-notification template. Pins the subject + body
 * shape AND the HTML-escaping behavior on every interpolated input —
 * the template is the only path through which order data lands in
 * customer-visible HTML, so escaping has to be airtight.
 */
import { describe, it, expect } from 'vitest';
import { buildShipNotification } from '@/lib/email/templates/ship-notification';

describe('buildShipNotification', () => {
  const baseInput = {
    customerEmail: 'parent@example.com',
    childName: 'Iris',
    orderId: 'order-uuid-1234-5678-deadbeef',
    pdfUrl: 'https://example.com/book.pdf',
  };

  it('sets `to` from customerEmail', () => {
    expect(buildShipNotification(baseInput).to).toBe('parent@example.com');
  });

  it('subject includes the child name', () => {
    expect(buildShipNotification(baseInput).subject).toBe("Iris's book is ready");
  });

  it('text version includes the PDF URL + short order id', () => {
    const { text } = buildShipNotification(baseInput);
    expect(text).toContain('https://example.com/book.pdf');
    expect(text).toContain('order-uu'); // first 8 chars of uuid
    expect(text).toContain("Iris's book is ready.");
    expect(text).toContain('hello@tuatale.com');
    expect(text).toContain('— Tuatale');
  });

  it('html includes the PDF URL inside the Download button href', () => {
    const { html } = buildShipNotification(baseInput);
    expect(html).toContain('href="https://example.com/book.pdf"');
    expect(html).toContain('Download the book');
  });

  it('html escapes special characters in the child name (XSS prevention)', () => {
    const html = buildShipNotification({
      ...baseInput,
      childName: '<script>alert(1)</script>',
    }).html;
    // The literal tag must NOT appear as live HTML.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes attribute-breaking characters in the pdfUrl', () => {
    // A maliciously-crafted URL with a stray quote would break out of
    // the href attribute and rewrite subsequent attributes. Escape
    // turns it into an entity.
    const html = buildShipNotification({
      ...baseInput,
      pdfUrl: 'https://example.com/book.pdf"><img src=x onerror=alert(1)>',
    }).html;
    expect(html).not.toContain('"><img src=x');
    expect(html).toContain('&quot;');
  });

  it('escapes ampersands in any interpolated value (entity correctness)', () => {
    const html = buildShipNotification({
      ...baseInput,
      pdfUrl: 'https://example.com/book.pdf?a=1&b=2',
    }).html;
    expect(html).toContain('https://example.com/book.pdf?a=1&amp;b=2');
  });

  it('still produces a valid email object when pdfUrl is empty (edge case)', () => {
    const result = buildShipNotification({ ...baseInput, pdfUrl: '' });
    expect(result.to).toBe('parent@example.com');
    expect(result.subject).toBe("Iris's book is ready");
    expect(result.html).toContain('href=""');
    expect(result.text).toContain('Download it here: ');
  });

  it('short-order-id slice is exactly the first 8 chars', () => {
    const { html, text } = buildShipNotification({
      ...baseInput,
      orderId: 'aaaaaaaabbbbbbbbcccccccc-d',
    });
    expect(html).toContain('Order aaaaaaaa');
    expect(text).toContain('Order aaaaaaaa');
    // Ensure we didn't accidentally render the full id.
    expect(html).not.toContain('cccccccc');
  });
});
