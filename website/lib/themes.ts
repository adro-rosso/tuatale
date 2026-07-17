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
  category: 'Milestones' | 'Adventures' | 'Everyday' | null;
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

/**
 * Pet-book theme presets (book_type='pet'). The child milestones ("first day of
 * school") are absurd for a pet, so pets get their own set, grouped Everyday +
 * Adventures. {child_name} resolves to the pet's name; pets have no gender, so
 * pronouns resolve to they/their. Written gently so they read as fond memories
 * too — they don't clash with the 'memorial' vibe (the free text covers specifics).
 */
export const PET_THEMES: ReadonlyArray<ThemeTemplate> = [
  // Everyday — the small, real, tail-thumping moments.
  {
    id: 'pet_brought_home',
    category: 'Everyday',
    title: 'The day we brought you home',
    starter:
      'The day {child_name} first came home is one nobody in the family will ever forget. The house was small and quiet in the morning, and by evening it was a warmer, happier, altogether better place to be.',
  },
  {
    id: 'pet_lazy_sunday',
    category: 'Everyday',
    title: 'A perfect lazy Sunday',
    starter:
      'Some days are just for slowing down. This is the story of a perfect lazy Sunday with {child_name}: warm sunbeams on the floor, a soft blanket, and absolutely nowhere in particular to be.',
  },
  {
    id: 'pet_favourite_walk',
    category: 'Everyday',
    title: 'Your favourite walk',
    starter:
      '{child_name} knows the way by heart. This is the story of their favourite walk, the one where every smell is an old friend and every corner holds a small, wonderful adventure.',
  },
  {
    id: 'pet_snack_heist',
    category: 'Everyday',
    title: 'The great snack heist',
    starter:
      'It was, everyone agreed later, the perfect crime. This is the story of the day {child_name} masterminded the great snack heist, and very nearly got away with it.',
  },
  // Adventures — ordinary places, turned wonderful.
  {
    id: 'pet_squirrel',
    category: 'Adventures',
    title: "The squirrel you'll never catch",
    starter:
      'There is one squirrel in the whole wide world that {child_name} is absolutely, completely determined to catch. This is the story of the greatest chase that never quite ends.',
  },
  {
    id: 'pet_beach',
    category: 'Adventures',
    title: 'A day at the beach',
    starter:
      'Salt in the air, sand between the toes, and the biggest water bowl {child_name} had ever seen. This is the story of one wonderful, wave-chasing day at the beach.',
  },
  {
    id: 'pet_backyard_jungle',
    category: 'Adventures',
    title: 'Exploring the backyard jungle',
    starter:
      'To everyone else it was just the backyard. To {child_name} it was a wild green jungle, full of mysteries to sniff out, territories to patrol, and the occasional very suspicious leaf.',
  },
  {
    id: 'pet_midnight_noise',
    category: 'Adventures',
    title: 'The mysterious midnight noise',
    starter:
      'It happened in the very middle of the night: a small, mysterious noise, somewhere in the sleeping house. And only {child_name} was brave enough to go and find out what it was.',
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
