/**
 * Cartoon Prompt Engine — Persistent Character Asset Sheets
 *
 * Extends CharacterDNA with a full production-grade character sheet:
 *   Wardrobe      — every clothing item with hex codes, textures, geometry
 *   ExpressionLib — named emotion states mapped to facial descriptor tokens
 *   AutoRigGuide  — skeleton joint hints for 2D/3D auto-rigging pipelines
 *   PropInventory — character-owned props with visual descriptors
 *   VoiceProfile  — reference to the character's voice synthesizer profile
 *
 * Character sheets are the single source of truth that ensures pixel-perfect
 * visual consistency across every shot and episode.  Downstream tools
 * (ComfyUI, auto-riggers, TTS engines) read from the sheet rather than
 * "guessing" what a character looks like or sounds like.
 *
 * Usage:
 *   import { buildCharacterSheet, CHARACTER_SHEETS } from './character-sheet';
 *
 *   const sheet = CHARACTER_SHEETS['investor_gadget'];
 *   const prompt = sheet.buildShotPrompt('running', 'heroic');
 *   // → "investor_gadget running — 2D hand-drawn cel-shaded, gray trench coat …
 *   //     confident expression: brow level, eyes wide, slight upward mouth curve …"
 */

import { CharacterDNA } from './types';
import { getDNA } from './characters';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single clothing item worn by the character. */
export interface WardrobeItem {
  /** Human-readable label (e.g. "trench coat", "fedora"). */
  label: string;
  /** Primary colour as CSS hex. */
  colour_hex: string;
  /** Secondary / trim colour as CSS hex (empty if none). */
  trim_hex: string;
  /** Fabric / material type. */
  material: string;
  /** Fit and silhouette notes. */
  silhouette_notes: string;
  /**
   * Prompt descriptor — the string injected into every frame prompt that
   * references this item.  Must be precise enough that AI models reproduce
   * exactly the same item across frames.
   */
  prompt_descriptor: string;
}

/**
 * ExpressionState — maps a named emotion to facial descriptor tokens.
 *
 * These tokens are appended to shot prompts whenever a specific emotion
 * is called for in the shot action line.
 */
export interface ExpressionState {
  /** Named emotion (e.g. "heroic", "surprised", "determined"). */
  label: string;
  /** Eyebrow descriptor. */
  brow: string;
  /** Eye-opening descriptor. */
  eyes: string;
  /** Mouth descriptor. */
  mouth: string;
  /** Nostril / nose descriptor (optional). */
  nose?: string;
  /**
   * Secondary action — body posture or prop movement that reinforces the
   * emotion (Disney Principle #9 — Secondary Action).
   */
  secondary_action: string;
  /** Full assembled prompt fragment — used directly in frame prompts. */
  prompt_fragment: string;
}

/**
 * AutoRigGuide — skeleton joint hints for AI auto-rigging pipelines.
 *
 * Lists the key joint locations in normalised UV space (0..1 on the
 * character's bounding box) and any special rig constraints.  Downstream
 * tools (e.g. Mixamo auto-rigger, Adobe Character Animator, or a custom
 * bone detection CNN) consume this data to place joints without manual work.
 */
export interface AutoRigGuide {
  /**
   * Root joint UV position (hips / pelvis centre).
   * x: 0=left, 1=right; y: 0=top, 1=bottom (UV convention, not screen Y).
   */
  root_uv: { x: number; y: number };
  /** Major joint positions in normalised UV space. */
  joints: Record<JointName, { x: number; y: number }>;
  /**
   * Rig constraints — special rules for this character.
   * e.g. "antenna is a 3-bone IK chain with stretch", "tail follows spine curve"
   */
  constraints: string[];
  /**
   * Motion transfer source hints — which retargeting profile to use when
   * transferring motion capture data to this rig.
   */
  retarget_profile: 'humanoid_biped' | 'quadruped' | 'custom';
}

/** Named skeleton joints supported by the auto-rig guide. */
export type JointName =
  | 'head'
  | 'neck'
  | 'shoulder_l'
  | 'shoulder_r'
  | 'elbow_l'
  | 'elbow_r'
  | 'wrist_l'
  | 'wrist_r'
  | 'spine_mid'
  | 'hip_l'
  | 'hip_r'
  | 'knee_l'
  | 'knee_r'
  | 'ankle_l'
  | 'ankle_r';

/** A prop belonging to this character's inventory. */
export interface CharacterProp {
  /** Prop identifier (e.g. "gadget_antenna"). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Whether the prop is always present or contextual. */
  presence: 'always' | 'contextual';
  /** Prompt descriptor injected when this prop is active. */
  prompt_descriptor: string;
  /** In which hand or body region the prop is held/worn. */
  attachment_point: string;
}

/**
 * CharacterSheet — the complete, permanent visual and behavioural asset
 * for one character.  Serialise to JSON and version alongside the codebase.
 */
export interface CharacterSheet {
  /** Matches the CharacterDNA.character_id. */
  character_id: string;
  /** Full display name. */
  display_name: string;
  /** One-line character archetype description. */
  archetype_summary: string;
  /** The immutable visual DNA (hex codes, shading mode, etc.). */
  dna: CharacterDNA;
  /** Every clothing item worn by this character. */
  wardrobe: WardrobeItem[];
  /** Named emotion states with facial descriptors. */
  expression_library: ExpressionState[];
  /** Skeleton joint placement guide for auto-rigging. */
  auto_rig_guide: AutoRigGuide;
  /** Props the character carries or wears. */
  prop_inventory: CharacterProp[];
  /**
   * buildShotPrompt()
   *
   * Assembles a complete frame prompt for a given action line and optional
   * named emotion.  Injects DNA, wardrobe, and expression automatically.
   *
   * @param actionLine  Scene-specific action description (e.g. "runs toward car")
   * @param emotion     Named emotion from expression_library (optional)
   * @returns           Full ComfyUI-ready prompt string
   */
  buildShotPrompt(actionLine: string, emotion?: string): string;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Look up an ExpressionState by label; returns a neutral fallback if not found. */
function findExpression(
  library: ExpressionState[],
  emotion: string | undefined
): string {
  if (!emotion) return '';
  const found = library.find((e) => e.label === emotion);
  return found ? found.prompt_fragment : '';
}

/** Build a CharacterSheet from raw config data. */
function makeSheet(
  config: Omit<CharacterSheet, 'buildShotPrompt'>
): CharacterSheet {
  return {
    ...config,
    buildShotPrompt(actionLine: string, emotion?: string): string {
      const wardrobeDesc = config.wardrobe
        .map((w) => w.prompt_descriptor)
        .join(', ');
      const expressionDesc = findExpression(config.expression_library, emotion);
      const propsDesc = config.prop_inventory
        .filter((p) => p.presence === 'always')
        .map((p) => p.prompt_descriptor)
        .join(', ');

      return [
        config.dna.prompt_descriptor,
        actionLine,
        wardrobeDesc,
        expressionDesc,
        propsDesc,
      ]
        .filter(Boolean)
        .join(', ');
    },
  };
}

// ---------------------------------------------------------------------------
// Investor Gadget character sheet
// ---------------------------------------------------------------------------

const INVESTOR_GADGET_SHEET = makeSheet({
  character_id:       'investor_gadget',
  display_name:       'Investor Gadget',
  archetype_summary:
    'A well-dressed gadget-wielding investor hero in a grey trench coat and fedora ' +
    'with a retractable chrome antenna.',
  dna: getDNA('investor_gadget'),
  wardrobe: [
    {
      label:             'Trench coat',
      colour_hex:        '#808080',
      trim_hex:          '#C0C0C0',
      material:          'heavy wool gabardine',
      silhouette_notes:  'Double-breasted, knee-length, wide lapels, belted waist',
      prompt_descriptor:
        'gray trench coat (#808080) double-breasted knee-length, wide lapels, ' +
        'chrome metallic buttons (#C0C0C0), belted waist, heavy wool silhouette',
    },
    {
      label:             'Fedora',
      colour_hex:        '#404040',
      trim_hex:          '#808080',
      material:          'felt',
      silhouette_notes:  'Wide brim, centre crease crown, hatband, retractable antenna at tip',
      prompt_descriptor:
        'dark grey fedora (#404040) wide-brim centre-crease crown, ' +
        'chrome retractable antenna at crown tip (cylindrical, 3-section telescoping)',
    },
    {
      label:             'Yellow gloves',
      colour_hex:        '#FFD700',
      trim_hex:          '',
      material:          'rubber investigative gloves',
      silhouette_notes:  'Full hand coverage, slightly oversized for expression',
      prompt_descriptor: 'bright yellow rubber gloves (#FFD700) full-hand coverage',
    },
    {
      label:             'White dress shirt',
      colour_hex:        '#F5F5F5',
      trim_hex:          '',
      material:          'cotton',
      silhouette_notes:  'Visible at collar and cuffs only',
      prompt_descriptor: 'white dress shirt collar (#F5F5F5) visible at neck and cuffs',
    },
    {
      label:             'Black tie',
      colour_hex:        '#1A1A1A',
      trim_hex:          '',
      material:          'silk',
      silhouette_notes:  'Standard width, Windsor knot',
      prompt_descriptor: 'black silk Windsor-knot tie (#1A1A1A)',
    },
  ],
  expression_library: [
    {
      label:            'heroic',
      brow:             'level, slightly furrowed inner corners',
      eyes:             'wide open, pupils centred, determined gaze',
      mouth:            'firm closed line, slight upward curve at corners',
      secondary_action: 'shoulders back, chest out, cape/coat billows slightly',
      prompt_fragment:
        'heroic expression: level brow, wide determined eyes, firm closed mouth slight smile, ' +
        'confident upright posture',
    },
    {
      label:            'surprised',
      brow:             'raised high, arched, 150 % above neutral position',
      eyes:             'circular, iris visible all around pupil, whites showing top and bottom',
      mouth:            'open oval, corners pulled back, teeth visible',
      secondary_action: 'arms raised 45° from sides, hair/hat lifts slightly',
      prompt_fragment:
        'surprised expression: highly raised arched brows, circular wide eyes showing whites, ' +
        'open oval mouth with visible teeth, arms raised',
    },
    {
      label:            'determined',
      brow:             'deeply furrowed, inner corners pushed together and down',
      eyes:             'narrowed to 60 % open, intense forward gaze',
      mouth:            'pressed tight line, corners turned slightly down',
      secondary_action: 'leaning forward 10°, fist clenched at side',
      prompt_fragment:
        'determined expression: deeply furrowed brow, narrowed intense eyes, ' +
        'tight pressed mouth, forward lean, clenched fist',
    },
    {
      label:            'concerned',
      brow:             'inner corners raised, creating worried inverted-V shape',
      eyes:             'slightly narrowed, looking slightly down',
      mouth:            'corners pulled slightly down, closed',
      secondary_action: 'hand raised toward chin in thinking pose',
      prompt_fragment:
        'concerned expression: worried inverted-V brow, slightly narrowed downward eyes, ' +
        'corners-down closed mouth, hand at chin',
    },
    {
      label:            'triumphant',
      brow:             'raised outer corners, relaxed inner corners — satisfied look',
      eyes:             'bright and open, slight squint from smile raising cheeks',
      mouth:            'wide open grin, teeth fully visible, cheeks bunched high',
      secondary_action: 'both arms raised overhead in V-shape, antenna extended fully',
      prompt_fragment:
        'triumphant expression: raised-outer-brow satisfied look, bright open smiling eyes, ' +
        'wide grin full teeth visible, both arms raised in victory V, antenna fully extended',
    },
  ],
  auto_rig_guide: {
    root_uv:   { x: 0.50, y: 0.62 },
    joints: {
      head:       { x: 0.50, y: 0.08 },
      neck:       { x: 0.50, y: 0.20 },
      shoulder_l: { x: 0.28, y: 0.26 },
      shoulder_r: { x: 0.72, y: 0.26 },
      elbow_l:    { x: 0.18, y: 0.42 },
      elbow_r:    { x: 0.82, y: 0.42 },
      wrist_l:    { x: 0.12, y: 0.58 },
      wrist_r:    { x: 0.88, y: 0.58 },
      spine_mid:  { x: 0.50, y: 0.44 },
      hip_l:      { x: 0.40, y: 0.62 },
      hip_r:      { x: 0.60, y: 0.62 },
      knee_l:     { x: 0.38, y: 0.76 },
      knee_r:     { x: 0.62, y: 0.76 },
      ankle_l:    { x: 0.37, y: 0.90 },
      ankle_r:    { x: 0.63, y: 0.90 },
    },
    constraints: [
      'Antenna is a 3-bone IK chain at head joint, stretch enabled, collapsed length = 0.05 UV units',
      'Coat tails follow hip rotation with 2-frame lag (secondary action)',
      'Glove fingers are single FK bone groups — no per-finger rig needed',
      'Fedora brim is a rigid body parented to head joint',
    ],
    retarget_profile: 'humanoid_biped',
  },
  prop_inventory: [
    {
      id:                 'gadget_antenna',
      label:              'Retractable Chrome Antenna',
      presence:           'always',
      prompt_descriptor:
        'chrome retractable telescoping antenna (3 sections, collapsed to 0.05 units, ' +
        'extended to 0.15 units) mounted at fedora crown tip',
      attachment_point: 'fedora crown (head joint)',
    },
    {
      id:                 'gadget_briefcase',
      label:              'Leather Briefcase',
      presence:           'contextual',
      prompt_descriptor:
        'dark brown leather briefcase with brass clasps, held in right hand at hip level',
      attachment_point: 'right wrist joint',
    },
    {
      id:                 'gadget_magnifier',
      label:              'Magnifying Glass',
      presence:           'contextual',
      prompt_descriptor:
        'round brass-frame magnifying glass with clear lens, held in right hand at eye level',
      attachment_point: 'right wrist joint',
    },
  ],
});

// ---------------------------------------------------------------------------
// Mouse character sheet
// ---------------------------------------------------------------------------

const MOUSE_SHEET = makeSheet({
  character_id:       'mouse_01',
  display_name:       'Mouse (Default)',
  archetype_summary:
    'A small, round-eared grey mouse protagonist in a classic 2D cel-shaded style.',
  dna: getDNA('mouse_01'),
  wardrobe: [
    {
      label:             'No clothing',
      colour_hex:        '#D3D3D3',
      trim_hex:          '',
      material:          'light grey fur',
      silhouette_notes:  'Unclothed animal character — fur texture defines silhouette',
      prompt_descriptor: 'light grey fur (#D3D3D3) unclothed mouse character, clean cel-shaded fur texture',
    },
  ],
  expression_library: [
    {
      label:            'hungry',
      brow:             'slightly drooped at inner corners, pleading look',
      eyes:             'large and glistening, pupils enlarged, looking upward',
      mouth:            'open slightly, tongue tip visible, drool drop at corner',
      secondary_action: 'hand clutching belly, hunched forward',
      prompt_fragment:
        'hungry expression: drooped pleading brows, large glistening upward eyes, ' +
        'slightly open mouth with tongue tip, belly-clutch pose',
    },
    {
      label:            'excited',
      brow:             'high arched, inner corners up',
      eyes:             'fully open wide, sparkling highlights × 3',
      mouth:            'huge grin, upper and lower teeth visible, cheeks bunched',
      secondary_action: 'jumping slightly, arms wide, ears perked forward',
      prompt_fragment:
        'excited expression: high arched brows, wide sparkling eyes triple highlight, ' +
        'huge toothy grin cheeks bunched, jumping pose arms wide ears perked',
    },
    {
      label:            'sneaky',
      brow:             'low, inner corners down — villainous look',
      eyes:             'narrowed to slits, pupils as vertical ovals',
      mouth:            'thin smirk, one corner raised',
      secondary_action: 'tiptoeing, body crouched, tail raised in S-curve',
      prompt_fragment:
        'sneaky expression: low villainous furrowed brow, narrowed slit eyes vertical pupils, ' +
        'thin smirk one corner raised, tiptoeing crouch tail raised',
    },
    {
      label:            'startled',
      brow:             'shot up, fully arched',
      eyes:             'huge circular, pupils pin-point, whites all around',
      mouth:            'square screaming open, uvula visible',
      secondary_action: 'all four limbs rigid, fur standing on end, leaping backward',
      prompt_fragment:
        'startled expression: fully arched shot-up brows, huge circular eyes pinpoint pupils ' +
        'all-white surround, square screaming open mouth, rigid all-limbs leap backward fur-on-end',
    },
  ],
  auto_rig_guide: {
    root_uv:   { x: 0.50, y: 0.55 },
    joints: {
      head:       { x: 0.50, y: 0.10 },
      neck:       { x: 0.50, y: 0.25 },
      shoulder_l: { x: 0.30, y: 0.32 },
      shoulder_r: { x: 0.70, y: 0.32 },
      elbow_l:    { x: 0.20, y: 0.47 },
      elbow_r:    { x: 0.80, y: 0.47 },
      wrist_l:    { x: 0.14, y: 0.60 },
      wrist_r:    { x: 0.86, y: 0.60 },
      spine_mid:  { x: 0.50, y: 0.46 },
      hip_l:      { x: 0.42, y: 0.58 },
      hip_r:      { x: 0.58, y: 0.58 },
      knee_l:     { x: 0.40, y: 0.72 },
      knee_r:     { x: 0.60, y: 0.72 },
      ankle_l:    { x: 0.38, y: 0.86 },
      ankle_r:    { x: 0.62, y: 0.86 },
    },
    constraints: [
      'Round ears are rigid caps parented to head joint, squash-and-stretch driven by head bone scale',
      'Tail is an 8-bone FK chain rooted at hip, secondary animation driven by IK spring',
      'Whiskers are rigid bones parented to nose tip, driven by facial blend shapes',
    ],
    retarget_profile: 'humanoid_biped',
  },
  prop_inventory: [
    {
      id:                 'cheese_wedge',
      label:              'Giant Cheese Wedge',
      presence:           'contextual',
      prompt_descriptor:
        'giant yellow Swiss cheese wedge with circular holes (#FFD700), ' +
        'held in both outstretched arms, larger than character torso',
      attachment_point: 'both wrist joints, carried in front of body',
    },
  ],
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const CHARACTER_SHEETS: Record<string, CharacterSheet> = {
  investor_gadget: INVESTOR_GADGET_SHEET,
  mouse_01:        MOUSE_SHEET,
};

/**
 * getCharacterSheet
 *
 * Returns the CharacterSheet for the given character ID.
 * Throws if the character is not registered.
 *
 * @param characterId  Registered character key (e.g. 'investor_gadget')
 */
export function getCharacterSheet(characterId: string): CharacterSheet {
  const sheet = CHARACTER_SHEETS[characterId];
  if (!sheet) {
    throw new Error(
      `CharacterSheet not found for "${characterId}". ` +
      `Register it in cartoon-engine/character-sheet.ts first.`
    );
  }
  return sheet;
}

/**
 * buildCharacterSheet
 *
 * Convenience factory: retrieves the sheet and immediately builds a shot prompt.
 */
export function buildCharacterSheet(
  characterId: string,
  actionLine: string,
  emotion?: string
): string {
  return getCharacterSheet(characterId).buildShotPrompt(actionLine, emotion);
}
