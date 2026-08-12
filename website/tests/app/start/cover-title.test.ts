/**
 * deriveCoverTitle + balanceTitleLines (Batch 4a). Pure, $0 — no LLM, no network.
 */
import { describe, it, expect } from 'vitest';
import { deriveCoverTitle, balanceTitleLines } from '@/lib/cover/title';
import { CUSTOM_TEMPLATE_ID } from '@/lib/themes';

describe('deriveCoverTitle — preset theme', () => {
  it('reuses the template title with a "for <name>" subline', () => {
    expect(deriveCoverTitle({ childName: 'Mia', bookType: 'child', themeTemplateId: 'milestone_first_school' }))
      .toEqual({ title: 'Your first day of school', subtitle: 'for Mia' });
  });

  it('drops the subline when there is no name', () => {
    const r = deriveCoverTitle({ childName: '', bookType: 'child', themeTemplateId: 'milestone_first_school' });
    expect(r.title).toBe('Your first day of school');
    expect(r.subtitle).toBeNull();
  });
});

describe('deriveCoverTitle — custom / no preset fallback (name in title, no subline)', () => {
  it('child with name → warm "Big Adventure"', () => {
    expect(deriveCoverTitle({ childName: 'Mia', bookType: 'child', themeTemplateId: CUSTOM_TEMPLATE_ID }))
      .toEqual({ title: "Mia's Big Adventure", subtitle: null });
  });

  it('pet with name → "Tale"', () => {
    expect(deriveCoverTitle({ childName: 'Benji', bookType: 'pet', themeTemplateId: null }))
      .toEqual({ title: "Benji's Tale", subtitle: null });
  });

  it('adult with name → "Story"', () => {
    expect(deriveCoverTitle({ childName: 'Marcus', bookType: 'adult', themeTemplateId: '' }))
      .toEqual({ title: "Marcus's Story", subtitle: null });
  });

  it('an unknown theme id falls back (not treated as a preset)', () => {
    expect(deriveCoverTitle({ childName: 'Mia', bookType: 'child', themeTemplateId: 'not_a_real_id' }))
      .toEqual({ title: "Mia's Big Adventure", subtitle: null });
  });

  it('no name → generic "A Little <word>" per book type', () => {
    expect(deriveCoverTitle({ childName: '', bookType: 'child', themeTemplateId: CUSTOM_TEMPLATE_ID }).title)
      .toBe('A Little Adventure');
    expect(deriveCoverTitle({ bookType: 'pet' }).title).toBe('A Little Tale');
    expect(deriveCoverTitle({ bookType: 'adult' }).title).toBe('A Little Story');
  });

  it('defaults bookType to child when absent', () => {
    expect(deriveCoverTitle({ childName: 'Sam' }).title).toBe("Sam's Big Adventure");
  });
});

describe('balanceTitleLines', () => {
  it('keeps ≤3 words on one line', () => {
    expect(balanceTitleLines("Benji's Tale")).toEqual(["Benji's Tale"]);
    expect(balanceTitleLines('The great snack heist')).toHaveLength(2); // 4 words → 2 lines
  });

  it('splits longer titles into 2 balanced lines that rejoin to the original', () => {
    const lines = balanceTitleLines('Your first day of school');
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe('Your first day of school');
  });
});
