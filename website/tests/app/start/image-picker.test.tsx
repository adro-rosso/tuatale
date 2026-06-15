/**
 * ImagePicker — the wizard's accessible thumbnail radio-grid (Spec: visual
 * reference images, 2026-06-14). Real form control + gender-matched thumbnails +
 * graceful fallback when a thumbnail is missing.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImagePicker } from '@/app/start/child/ImagePicker';

const radios = () => screen.getAllByRole('radio') as HTMLInputElement[];

describe('ImagePicker', () => {
  it('renders one radio per option, submitting via the axis name + raw value', () => {
    render(<ImagePicker name="hair_colour" label="Hair colour" axis="hair_colour" value="" options={['black', 'brown', 'auburn']} gender="boy" />);
    const r = radios();
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.value)).toEqual(['black', 'brown', 'auburn']);
    expect(r.every((x) => x.name === 'hair_colour')).toBe(true);
  });

  it('marks the current value checked', () => {
    render(<ImagePicker name="eye_colour" label="Eye colour" axis="eye_colour" value="green" options={['blue', 'green', 'hazel']} gender="girl" />);
    const checked = radios().filter((x) => x.checked);
    expect(checked.map((x) => x.value)).toEqual(['green']);
  });

  it('uses the gender-matched thumbnail path (non_binary → girl set)', () => {
    const { rerender } = render(<ImagePicker name="skin_tone" label="Skin" axis="skin_tone" value="" options={['tan']} gender="boy" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/feature-thumbs/watercolor/skin_tone/boy/tan.png');
    rerender(<ImagePicker name="skin_tone" label="Skin" axis="skin_tone" value="" options={['tan']} gender="girl" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/feature-thumbs/watercolor/skin_tone/girl/tan.png');
    rerender(<ImagePicker name="skin_tone" label="Skin" axis="skin_tone" value="" options={['tan']} gender="non_binary" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/feature-thumbs/watercolor/skin_tone/girl/tan.png');
  });

  it('reflects whatever options it is given (gender filtering happens upstream)', () => {
    const { rerender } = render(<ImagePicker name="hair_style" label="Hair style" axis="hair_style" value="" options={['buzzed', 'short', 'tousled']} gender="boy" />);
    expect(radios()).toHaveLength(3);
    rerender(<ImagePicker name="hair_style" label="Hair style" axis="hair_style" value="" options={['buzzed', 'short', 'long', 'pigtails', 'bun']} gender="girl" />);
    expect(radios()).toHaveLength(5);
  });

  it('falls back to a clean label when a thumbnail is missing — no broken image', () => {
    render(<ImagePicker name="hair_colour" label="Hair colour" axis="hair_colour" value="" options={['auburn']} gender="boy" />);
    const img = screen.getByRole('img');
    fireEvent.error(img); // simulate the 404 most thumbnails hit today
    expect(screen.queryByRole('img')).toBeNull();
    // the radio + its label remain — still a working control
    expect(radios()).toHaveLength(1);
    expect(screen.getAllByText('Auburn').length).toBeGreaterThan(0);
  });

  it('surfaces a validation error message', () => {
    render(<ImagePicker name="hair_style" label="Hair style" axis="hair_style" value="" options={['long']} gender="boy" error="That style isn't available for boys yet." />);
    expect(screen.getByRole('alert')).toHaveTextContent(/available for boys/i);
  });
});
