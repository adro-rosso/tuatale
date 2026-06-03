/**
 * Theme templates for the /start/theme picker.
 *
 * Each template has a starter sentence (~1-2 lines) that pre-fills the
 * textarea when the customer clicks the card. The customer can then
 * edit freely. Starter text uses tokens that the form resolves from the
 * draft:
 *
 *   {child_name}                  → "Iris"
 *   {child_pronoun_subject_lc}    → "she" / "he" / "they"
 *   {child_pronoun_object_lc}     → "her" / "him" / "them"
 *   {child_pronoun_possessive_lc} → "her" / "his" / "their"
 *
 * If child_name is empty (rare — theme step runs after child step), the
 * token resolves to "your child". Gender pronouns default to "they" /
 * "them" / "their" when child_gender is non_binary or unknown.
 */

export interface ThemeTemplate {
  id: string;
  category: 'Milestones' | 'Adventures' | null;
  title: string;
  starter: string;
}

export const THEMES: ReadonlyArray<ThemeTemplate> = [
  // Milestones — real-life-shaped story arcs.
  {
    id: 'milestone_first_school',
    category: 'Milestones',
    title: 'Your first day of school',
    starter:
      "It was {child_name}'s first day of school. {child_pronoun_subject_lc_cap} woke up early, before the kitchen even smelled like toast, and just lay there listening to the house wake up.",
  },
  {
    id: 'milestone_first_bike',
    category: 'Milestones',
    title: 'Learning to ride a bike',
    starter:
      '{child_name} had been waiting all summer for this. Today was the day {child_pronoun_subject_lc} would learn to ride a bike — really ride it, no training wheels, no holding on.',
  },
  {
    id: 'milestone_new_sibling',
    category: 'Milestones',
    title: 'A new sibling arrives',
    starter:
      'Tomorrow the house would have someone new in it. {child_name} sat on the front step and thought about that for a long time.',
  },
  {
    id: 'milestone_big_move',
    category: 'Milestones',
    title: 'The big move',
    starter:
      "The boxes were everywhere. {child_name} stood in the middle of {child_pronoun_possessive_lc} bedroom — only it wasn't really {child_pronoun_possessive_lc} bedroom anymore — and tried to remember what colour the walls used to be.",
  },
  // Adventures — wonder-shaped, more imaginative.
  {
    id: 'adventure_hidden_world',
    category: 'Adventures',
    title: 'Discovering a hidden world',
    starter:
      "It was a perfectly ordinary afternoon, until {child_name} noticed the small door in the garden wall. It hadn't been there yesterday. {child_pronoun_subject_lc_cap} was sure of it.",
  },
  {
    id: 'adventure_stars',
    category: 'Adventures',
    title: 'A journey through the stars',
    starter:
      '{child_name} had never met a spaceship before. The one at the bottom of {child_pronoun_possessive_lc} garden was small and silver and very, very quiet.',
  },
  {
    id: 'adventure_magical_friend',
    category: 'Adventures',
    title: 'Meeting a magical friend',
    starter:
      "{child_name} found the creature behind the woodpile. It looked up at {child_pronoun_object_lc} with serious, ancient eyes and said, 'I've been waiting for you.'",
  },
  {
    id: 'adventure_everything_changed',
    category: 'Adventures',
    title: 'The day everything changed',
    starter:
      'Later, when {child_name} tried to explain what happened, the words never quite landed right. It started on a Tuesday — a normal Tuesday, even — but by lunchtime nothing was normal anymore.',
  },
] as const;

export const CUSTOM_TEMPLATE_ID = 'custom';

interface ResolveOptions {
  childName: string | null;
  childGender: 'boy' | 'girl' | 'non_binary' | null;
}

/**
 * Resolve {child_name} + pronoun tokens in a starter sentence.
 *
 * Defaults to 'your child' + 'they/them/their' when child fields aren't
 * known (very rare since the theme step runs after the child step).
 */
export function resolveStarter(
  starter: string,
  { childName, childGender }: ResolveOptions,
): string {
  const name = childName?.trim() || 'your child';
  const pronouns = {
    boy: { subject: 'he', object: 'him', possessive: 'his' },
    girl: { subject: 'she', object: 'her', possessive: 'her' },
    non_binary: { subject: 'they', object: 'them', possessive: 'their' },
  };
  const p = pronouns[childGender ?? 'non_binary'];
  return starter
    .replaceAll('{child_name}', name)
    .replaceAll('{child_pronoun_subject_lc}', p.subject)
    .replaceAll('{child_pronoun_subject_lc_cap}', p.subject[0]!.toUpperCase() + p.subject.slice(1))
    .replaceAll('{child_pronoun_object_lc}', p.object)
    .replaceAll('{child_pronoun_possessive_lc}', p.possessive);
}
