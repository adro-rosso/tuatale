import { getDraft } from '@/lib/draft-fetch';
import { StyleForm } from './StyleForm';

/**
 * Step 1 — choose the art style (W-F). This comes BEFORE the character step
 * because the whole-character previews on /start/child render in the chosen
 * style, so the style must be picked first. Six swatches (the style-probe
 * portraits); default watercolour. Writes draft.art_style.
 */
export default async function StyleStepPage() {
  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;
  const initial = (draft as { art_style?: string | null } | null)?.art_style ?? 'watercolour';

  return <StyleForm initial={initial} />;
}
