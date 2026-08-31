// Canned per-theme COVER CONCEPTS for the pre-purchase cover-scene preview (Phase 2).
//
// The post-purchase cover gets its cover_concept from a full Sonnet story call; a $0.04
// single-render preview must NOT pay for a story, so it uses these deterministic per-theme
// art-direction notes instead. Each is 2-3 sentences: the signature action/moment + mood,
// with the protagonist's face/action in the UPPER HALF and the LOWER ~40% kept calm/open
// (that band is reserved for the title panel the client overlays). Keyed by theme_template_id
// (website/lib/themes.ts). Unknown / custom theme → the generic fallback.

export const GENERIC_COVER_CONCEPT =
  "The protagonist is at the heart of their story's most joyful, characterful moment — alive and " +
  "inviting, caught mid-action or looking warmly out toward the viewer. Warm, richly atmospheric " +
  "light. Keep the lower foreground calm and open.";

export const COVER_CONCEPTS = {
  // --- Child milestones ---
  milestone_first_school:
    "The child stands at an open school gate on a bright morning, a colourful backpack on their shoulders, looking up at the big building with a brave, excited smile. Soft morning light; a calm open path leading to the gate in the foreground.",
  milestone_first_bike:
    "The child rides a bicycle for the very first time down a sun-dappled path, hands steady on the handlebars, hair streaming back, face lit with triumphant joy. Warm afternoon light; a calm stretch of open path and grass in the foreground.",
  milestone_new_sibling:
    "The child sits gently cradling a tiny new baby sibling, looking down with tender wonder and pride, wrapped in a cosy blanket. Soft warm indoor light; a calm quiet rug and floor in the foreground.",
  milestone_big_move:
    "The child stands in the doorway of a new home holding a favourite toy, looking out at a fresh new street with cautious wonder. Warm golden light; an open, calm doorstep and path in the foreground.",
  // --- Child adventures ---
  adventure_hidden_world:
    "The child pushes open a small glowing door in a garden wall, peering into a wondrous hidden world beyond, eyes wide with awe as magical light spills out. Rich atmospheric glow; a calm shadowed garden foreground.",
  adventure_stars:
    "The child floats joyfully among glowing stars beside a small silver spaceship, reaching toward a shimmering planet, face full of wonder. Deep starry sky with warm glow; a calm open expanse in the lower frame.",
  adventure_magical_friend:
    "The child meets a gentle magical creature in a sunlit forest clearing, the two leaning toward one another in a moment of quiet friendship and wonder. Dappled golden light; a soft calm mossy foreground.",
  adventure_everything_changed:
    "The child stands at the edge of an extraordinary transformation, wind in their hair, looking out at a world turning wondrous and strange — caught between awe and courage. Dramatic warm light; a calm open foreground.",

  // --- Pet everyday ---
  pet_brought_home:
    "The pet sits proudly in the middle of a cosy living room on their very first day home, tail mid-wag, looking up with bright hopeful eyes as warm light fills the room. Soft golden indoor glow; a calm rug and floor in the foreground.",
  pet_lazy_sunday:
    "The pet stretches contentedly in a warm patch of Sunday sunlight on a soft blanket, eyes half-closed in blissful comfort. Gentle warm light; a calm cosy floor in the foreground.",
  pet_favourite_walk:
    "The pet trots happily along a favourite tree-lined path, ears up, nose high, tail wagging mid-walk. Warm dappled light; a calm open path in the foreground.",
  pet_snack_heist:
    "The pet is caught mid-mischief reaching for a stolen treat, one paw raised, wearing an expression of gleeful guilt. Warm kitchen light; a calm clear floor in the foreground.",
  pet_squirrel:
    "The pet dashes joyfully across a sunlit park chasing a cheeky squirrel, ears flying, pure delight on their face. Bright warm light; a calm stretch of grass in the foreground.",
  pet_beach:
    "The pet bounds through the shallows at the beach, splashing sea spray, ears flapping, mouth open in a happy grin. Warm seaside light; a calm expanse of wet sand and gentle water in the foreground.",
  pet_backyard_jungle:
    "The pet explores a lush green backyard turned wild jungle, nosing curiously through tall leafy plants, ears perked with adventurous focus. Warm dappled light; a calm leafy foreground.",
  pet_midnight_noise:
    "The pet stands alert and brave in a moonlit hallway, ears pricked toward a mysterious sound, eyes wide and curious. Soft blue-and-warm night glow; a calm quiet floor in the foreground.",

  // --- Adult ---
  adult_milestone_birthday:
    "The person stands warmly lit amid a gentle swirl of celebration, raising a glass with a knowing, contented smile. Warm golden glow; a calm open foreground.",
  adult_new_chapter:
    "The person stands at an open doorway looking out toward a bright new horizon with a small hopeful smile, coat in hand. Warm golden light; a calm open path in the foreground.",
  adult_the_life_we_share:
    "The person sits comfortably in a cosy, lamp-lit room mid-laugh, warm and at ease in a familiar shared space. Soft warm light; a calm foreground.",
  adult_their_ways:
    "The person is caught in a fond, characterful moment doing one of their signature little rituals, warm and full of personality. Soft warm light; a calm foreground.",
  adult_the_wrong_turn:
    "The person stands at a comical crossroads holding a map upside-down, eyebrows raised in bemused good humour as an adventure unfolds. Warm adventurous light; a calm open foreground.",
};

/** The canned cover concept for a theme_template_id, or the generic fallback. */
export function coverConceptForTheme(themeTemplateId) {
  return COVER_CONCEPTS[themeTemplateId] || GENERIC_COVER_CONCEPT;
}
