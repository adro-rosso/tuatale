import { getDraft } from '@/lib/draft-fetch';
import { ChildForm } from './ChildForm';
import { PetForm } from './PetForm';
import { featuresToFormValues } from '@/lib/child-form';

/**
 * Step 2 — about your child. Real form: name, age range, gender, an optional
 * structured "build your character" section, and a free-text additive note.
 * Pre-fills from the draft (incl. the structured features blob) so a returning
 * customer sees what they previously chose.
 *
 * art_style (chosen in the prior /start/style step) flows in so the live
 * character preview renders in that style.
 */
export default async function ChildStepPage() {
  const result = await getDraft();
  const draft = result.kind === 'found' ? result.draft : null;
  const artStyle = (draft as { art_style?: string | null } | null)?.art_style ?? 'watercolour';

  // Pet-as-hero: when the hero step chose a pet, render the pet form instead.
  const bookType = (draft as { book_type?: string | null } | null)?.book_type ?? 'child';
  if (bookType === 'pet') {
    const petPhotos = (draft as { photo_urls?: { pet?: string[] } | null } | null)?.photo_urls?.pet ?? [];
    return (
      <PetForm
        initial={{
          name: draft?.child_name ?? '',
          age_range: draft?.age_range ?? '',
          animal_kind: (draft as { animal_kind?: string | null } | null)?.animal_kind ?? '',
          appearance: draft?.child_appearance ?? '',
          photos: Array.isArray(petPhotos) ? petPhotos : [],
        }}
      />
    );
  }

  return (
    <ChildForm
      artStyle={artStyle}
      draftId={draft?.id ?? null}
      initial={{
        name: draft?.child_name ?? '',
        age_range: draft?.age_range ?? '',
        gender: draft?.child_gender ?? '',
        appearance: draft?.child_appearance ?? '',
        background: (draft as { background?: string | null } | null)?.background ?? '',
        // '' when the draft has no override → the card shows the age-derived
        // default but stores NULL (worker derives from band). A concrete value
        // means the parent previously overrode it → respected on return.
        reading_level: (draft as { reading_level?: string | null } | null)?.reading_level ?? '',
        ...featuresToFormValues(draft?.child_features),
      }}
    />
  );
}
