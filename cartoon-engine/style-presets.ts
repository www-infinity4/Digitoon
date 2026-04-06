/**
 * Cartoon Prompt Engine — Multi-Model Animation Style Presets
 *
 * Defines the full visual language for each supported animation style family.
 * Every preset is a complete descriptor set that maps to a specific downstream
 * rendering pipeline (ComfyUI workflow node graph, model checkpoint, and LoRA
 * stack) while remaining pipeline-agnostic at the engine level.
 *
 * Style families supported:
 *   2d_cel_shaded    Classic TV cartoon / Looney Tunes aesthetic
 *   3d_pixar         Soft volumetric 3-D with subsurface scattering (Pixar RenderMan look)
 *   2d_anime         Japanese limited animation with flat shading and speed lines
 *   ghibli           Studio Ghibli — hand-painted watercolour backgrounds, expressive characters
 *   classic_disney   Golden-age Disney — multiplane backgrounds, smooth arcs, full animation
 *   2d_noir          Monochrome chiaroscuro inspired by 1940s UPA / Max Fleischer
 *
 * Each preset specifies:
 *   MaterialSystem    How skin, fabric, and metal surfaces are rendered
 *   FaceReadability   Eye proportion, expression emphasis, and emotion legibility rules
 *   CinematicRender   Global illumination mode, atmospheric perspective, DoF regime
 *   ComfyUIHints      Which model checkpoints / LoRA names produce this look
 *
 * Usage:
 *   import { getStylePreset, STYLE_PRESETS, StyleFamily } from './style-presets';
 *
 *   const preset = getStylePreset('3d_pixar');
 *   const prompt = preset.buildPrompt('Investor Gadget walks through Times Square');
 *   // → "Investor Gadget walks through Times Square, Pixar 3D CGI style, ..."
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported animation style families. */
export type StyleFamily =
  | '2d_cel_shaded'
  | '3d_pixar'
  | '2d_anime'
  | 'ghibli'
  | 'classic_disney'
  | '2d_noir';

/**
 * MaterialSystem — how character surface materials are rendered.
 *
 * Each descriptor is a prompt fragment injected when the material appears
 * in a shot.  Downstream AI generators (ComfyUI, Kling, Runway) interpret
 * these terms through their LoRA / checkpoint training vocabulary.
 */
export interface MaterialSystem {
  /** Skin / fur surface — subsurface scattering, translucency, pore texture. */
  skin_descriptor: string;
  /** Fabric / clothing — weave, sheen, drape behaviour. */
  fabric_descriptor: string;
  /** Metal / hard surface — reflectivity, anisotropy, scratches. */
  metal_descriptor: string;
  /** Global illumination mode — soft GI, HDRI, raster flat. */
  global_illumination: string;
  /** Atmospheric perspective — depth haze, aerial perspective, value shift. */
  atmospheric_perspective: string;
}

/**
 * FaceReadability — rules for expressive, emotion-legible character faces.
 *
 * Based on Disney Animation's "12 principles" and Pixar's character-readability
 * guidelines: faces must communicate emotion at a glance, even in wide shots.
 */
export interface FaceReadability {
  /** Eye style — proportion, highlight placement, pupil type. */
  eye_style: string;
  /**
   * Facial proportion rules — head-to-body ratio, chin width, forehead height.
   * Designed to keep the face readable as a thumbnail.
   */
  proportion_notes: string;
  /** How emotions are amplified beyond realistic proportions. */
  expression_emphasis: string;
  /**
   * Silhouette legibility — the character must read as a clean shape
   * against the background (key Disney/Pixar principle).
   */
  silhouette_rule: string;
}

/**
 * CinematicRender — camera and lighting aesthetics for this style.
 */
export interface CinematicRender {
  /** Depth-of-field regime. */
  dof_mode: 'sharp_everything' | 'shallow_focus' | 'rack_focus' | 'tilt_shift';
  /** Ambient occlusion style. */
  ao_style: string;
  /** Highlight treatment (specular shape). */
  highlight_treatment: string;
  /** Shadow edge character. */
  shadow_character: string;
  /** Motion blur style. */
  motion_blur: string;
  /** Recommended frame rate note for this style. */
  fps_note: string;
}

/**
 * ComfyUIHints — recommended model stacks for this style preset.
 *
 * These are checkpoint / LoRA identifiers as they appear in the CivitAI
 * model hub or Hugging Face.  The engine emits these in the ComfyUI
 * workflow JSON so users can load the correct models automatically.
 */
export interface ComfyUIHints {
  /** Primary checkpoint (base model). */
  checkpoint: string;
  /** Optional LoRA stack (ordered — first applied first). */
  loras: string[];
  /**
   * ComfyUI VAE name override.  Leave empty to use the checkpoint's
   * built-in VAE.
   */
  vae: string;
  /** Recommended sampler name (e.g. "dpmpp_2m_sde", "euler_a"). */
  sampler: string;
  /** Recommended CFG scale. */
  cfg: number;
  /** Recommended denoising steps. */
  steps: number;
}

/** A complete animation style preset. */
export interface StylePreset {
  id: StyleFamily;
  name: string;
  /** One-sentence description of the visual look. */
  description: string;
  /** Prompt prefix injected before the scene description. */
  prompt_prefix: string;
  /** Negative prompt — what to exclude from the generated image. */
  negative_prompt: string;
  /** Plain-text render notes for human artists. */
  render_notes: string;
  material: MaterialSystem;
  face: FaceReadability;
  cinematic: CinematicRender;
  comfyui_hints: ComfyUIHints;
  /**
   * buildPrompt()
   *
   * Assembles a complete ComfyUI-ready prompt from a scene description by
   * prepending the style prefix and appending material + face descriptors.
   */
  buildPrompt(sceneDescription: string): string;
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

function makePreset(
  base: Omit<StylePreset, 'buildPrompt'>
): StylePreset {
  return {
    ...base,
    buildPrompt(sceneDescription: string): string {
      return [
        base.prompt_prefix,
        sceneDescription,
        base.material.skin_descriptor,
        base.material.global_illumination,
        base.face.eye_style,
        base.face.silhouette_rule,
        base.cinematic.highlight_treatment,
      ]
        .filter(Boolean)
        .join(', ');
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Classic 2D Cel-Shaded
// ---------------------------------------------------------------------------

const CEL_SHADED = makePreset({
  id: '2d_cel_shaded',
  name: 'Classic 2D Cel-Shaded',
  description:
    '2D hand-drawn cartoon look with clean black outlines and flat 2-tone shading.',
  prompt_prefix:
    '2D hand-drawn cel-shaded animation, clean black outlines 2px, flat colour fills, ' +
    'TV cartoon aesthetic, limited animation, saturated palette,',
  negative_prompt:
    'photorealistic, 3D render, subsurface scattering, bokeh, lens flare, noise, grain, ' +
    'hyperdetailed, realistic skin, gradient shading',
  render_notes:
    'Use KSampler with DPM++ 2M Karras, CFG 7.5, steps 25. Apply cartoon LoRA at 0.8 weight.',
  material: {
    skin_descriptor: 'flat cel-shaded skin, 2-tone colour fill, hard shadow edge, no pore detail',
    fabric_descriptor: 'flat colour fabric, minimal crease lines, bold silhouette',
    metal_descriptor: 'cel-shaded chrome, stark specular dot, no anisotropy',
    global_illumination: 'flat ambient, single key light direction, hard shadow',
    atmospheric_perspective: 'none — flat background planes, no aerial haze',
  },
  face: {
    eye_style: 'large circular eyes, white circular highlight spot, black iris, thick outline',
    proportion_notes:
      '1:1.5 head-to-body ratio, oversized cranium, small chin, large forehead, ' +
      'eyes occupy 40 % of face height',
    expression_emphasis:
      'squash-and-stretch exaggeration, eyebrows travel high off the face, ' +
      'mouth stretches to 120 % of head width for shock expressions',
    silhouette_rule:
      'character must read as a clean contrasting shape against background — ' +
      'use rim outline or contrasting background colour at character edge',
  },
  cinematic: {
    dof_mode: 'sharp_everything',
    ao_style: 'none — AO breaks the flat cartoon look',
    highlight_treatment: 'single specular dot, shape-consistent across materials',
    shadow_character: 'hard edge, 2-tone only, shadow colour is darkened version of fill',
    motion_blur: 'speed lines in direction of travel, no camera blur',
    fps_note: '24 fps — holds on action frames (2s on 2s animation)',
  },
  comfyui_hints: {
    checkpoint: 'toonyou_beta6.safetensors',
    loras: ['cartoon_line_art_v3.safetensors', 'cel_shading_v2.safetensors'],
    vae: 'vae-ft-mse-840000-ema-pruned.safetensors',
    sampler: 'dpmpp_2m',
    cfg: 7.5,
    steps: 25,
  },
});

// ---------------------------------------------------------------------------
// 2. 3D Pixar
// ---------------------------------------------------------------------------

const PIXAR_3D = makePreset({
  id: '3d_pixar',
  name: '3D Pixar CGI',
  description:
    'Soft volumetric 3-D with subsurface scattering and global illumination mimicking ' +
    'Pixar RenderMan output.',
  prompt_prefix:
    'Pixar 3D CGI animation, high-quality render, subsurface scattering, soft global illumination, ' +
    'volumetric lighting, clean studio render, smooth normals,',
  negative_prompt:
    'flat 2D, cel shading, anime, hand-drawn, sketch, low poly, pixel art, photorealistic skin pores, ' +
    'uncanny valley, VHS, grain, noise',
  render_notes:
    'Use AnimateDiff with SD 1.5 base + 3D Pixar LoRA. CFG 6.0, steps 30, DPM++ 2M SDE.',
  material: {
    skin_descriptor:
      'subsurface scattering skin, soft translucent edges, peach-tone SSS, studio-lit complexion, ' +
      'no visible pores, smooth geometry normals',
    fabric_descriptor:
      'soft cloth simulation, micro-fibre detail, subtle spec highlight, gentle wrinkle lines',
    metal_descriptor:
      'polished metal with anisotropic highlight streak, IBL reflections, fingerprint-free studio look',
    global_illumination:
      'soft HDRI dome light, secondary bounce fill from ground plane, ' +
      'warm key at 45° above left, cool rim at 135° behind right',
    atmospheric_perspective:
      'gentle aerial haze at far depth, warm atmosphere desaturation, ' +
      'background value shift toward sky colour',
  },
  face: {
    eye_style:
      'large expressive eyes with specular catchlight cluster (2–3 highlights), ' +
      'deep iris colour with limbal ring, rounded cornea bulge, ' +
      'SSS eyelid skin visible at close range',
    proportion_notes:
      '1:1.8 head-to-body ratio, smooth rounded chin, wide cheekbones, ' +
      'eyes occupy 35 % of face height — readable as silhouette from 10m',
    expression_emphasis:
      'brow ridge flexes 25° above rest position for strong emotions, ' +
      'cheek puff on smile, nasolabial fold implies age/warmth, ' +
      'forehead wrinkle for worry — all via blend-shape, no texture baking',
    silhouette_rule:
      'rim light separates character from background — always place a secondary light ' +
      'at 120–160° from camera to edge-light the outermost silhouette',
  },
  cinematic: {
    dof_mode: 'shallow_focus',
    ao_style: 'soft SSAO, subtle contact shadows at feet and props',
    highlight_treatment:
      'multi-lobe specular — broad GGX main lobe + sharp Blinn secondary',
    shadow_character:
      'soft penumbra at 0.5m subject distance, hard contact shadow at object base',
    motion_blur: 'camera motion blur at 180° shutter angle, character motion blur per-limb',
    fps_note: '24 fps — full animation (1s on 1s), held only for blinks/holds',
  },
  comfyui_hints: {
    checkpoint: 'realisticVisionV60B1_v51HyperVAE.safetensors',
    loras: ['pixar_style_v2.safetensors', '3d_render_style_xl.safetensors'],
    vae: '',
    sampler: 'dpmpp_2m_sde',
    cfg: 6.0,
    steps: 30,
  },
});

// ---------------------------------------------------------------------------
// 3. 2D Anime
// ---------------------------------------------------------------------------

const ANIME_2D = makePreset({
  id: '2d_anime',
  name: '2D Anime (Limited Animation)',
  description:
    'Japanese limited animation — flat shading, speed lines, and dramatic cuts.',
  prompt_prefix:
    'anime style, cel animation, flat shading, speed lines, vibrant colour, ' +
    'sharp contrast, Japanese animation aesthetic,',
  negative_prompt:
    'photorealistic, 3D render, western cartoon, Pixar, Disney, realistic anatomy, ' +
    'subsurface scattering, film grain, bokeh, low contrast',
  render_notes:
    'Use Anything V5 or AbyssOrangeMix with anime-flat LoRA. CFG 7, steps 28, Euler a.',
  material: {
    skin_descriptor:
      'anime flat skin tone, single shadow band below cheekbone and nose, ' +
      'bright specular dot on nose tip, no pore texture',
    fabric_descriptor:
      'flat fabric with single fold line, minimal crease, bold colour blocking',
    metal_descriptor:
      'anime chrome — sharp linear highlight stripe across face of metal, ' +
      'flat reflection in dark areas',
    global_illumination:
      'flat ambient with single directional key, hard shadow band, ' +
      'cel-shadow boundary at 50 % grey threshold',
    atmospheric_perspective:
      'sky gradient only — no atmospheric haze on characters or mid-ground',
  },
  face: {
    eye_style:
      'large almond eyes, tall iris occupying 60 % of eye height, ' +
      'gradient iris from dark top to bright bottom, white highlight bar at top-right, ' +
      'thin upper lash line 2px, minimal lower lash',
    proportion_notes:
      '1:2 head-to-body ratio for adult characters, small pointed chin, ' +
      'eyes span 50 % of face width, tiny button nose, ' +
      'mouth is a minimal line except in close-up',
    expression_emphasis:
      'chibi deformation for comedy (head doubles in size), vein pop mark for anger, ' +
      'sweat drop for embarrassment, blush marks replace muscle movement',
    silhouette_rule:
      'hair silhouette defines the character shape — ensure hair spikes and ' +
      'ahoge are unobstructed; use background colour contrast at hairline',
  },
  cinematic: {
    dof_mode: 'sharp_everything',
    ao_style: 'none',
    highlight_treatment: 'single sharp stripe highlight, anime-style flat specular',
    shadow_character: 'hard binary shadow, cel edge at luma threshold 0.48',
    motion_blur: 'speed lines (motion streak lines) parallel to direction of travel',
    fps_note: '12 fps effective (2s on 2s animation with smear frames at action peaks)',
  },
  comfyui_hints: {
    checkpoint: 'anything-v5-PrtRE.safetensors',
    loras: ['anime_flat_v4.safetensors', 'lineart_anime_denoise.safetensors'],
    vae: 'anime.vae.pt',
    sampler: 'euler_a',
    cfg: 7.0,
    steps: 28,
  },
});

// ---------------------------------------------------------------------------
// 4. Studio Ghibli
// ---------------------------------------------------------------------------

const GHIBLI = makePreset({
  id: 'ghibli',
  name: 'Studio Ghibli',
  description:
    'Hand-painted watercolour backgrounds, soft character rendering, and a ' +
    'naturalistic colour palette inspired by Miyazaki productions.',
  prompt_prefix:
    'Studio Ghibli style animation, hand-painted watercolour background, soft painterly character, ' +
    'warm naturalistic palette, impressionistic detail, gentle cel shading,',
  negative_prompt:
    'photorealistic, 3D CGI, harsh outlines, neon colour, dark gritty tone, ' +
    'cel-shaded TV cartoon, low effort, digital plastic look',
  render_notes:
    'Use Counterfeit V3 + Ghibli background LoRA. CFG 6.5, steps 32, DPM++ 2M Karras.',
  material: {
    skin_descriptor:
      'soft watercolour wash skin, gentle warm blush on cheeks and knuckles, ' +
      'impressionistic pore-free surface, soft light wrap at edge',
    fabric_descriptor:
      'hand-painted fabric texture, visible brushstroke on weave, ' +
      'gentle colour variation within fills — not flat',
    metal_descriptor:
      'matte painted metal, diffuse surface with subtle directional sheen, ' +
      'no mirror reflections — impressionistic environment colour suggest',
    global_illumination:
      'soft diffuse sky dome, warm sunlight from upper-right at 30°, ' +
      'gentle secondary bounce from painted ground plane',
    atmospheric_perspective:
      'rich aerial perspective — background desaturates to pale blue-grey at distance, ' +
      'foreground elements are warm and high-chroma',
  },
  face: {
    eye_style:
      'large round eyes, dark iris with subtle grey highlight, minimal lash, ' +
      'soft shadow under brow ridge, no hard lash line — gentle ink wash outline',
    proportion_notes:
      '1:2.2 head-to-body ratio, soft oval face, gentle chin, ' +
      'eyes slightly below centre of face — Ghibli formula ' +
      '(large forehead encodes youth and wonder)',
    expression_emphasis:
      'micro-expressions via eyebrow tilt and eye lid position — ' +
      'emotions are understated and read through posture as much as face, ' +
      'open-mouth shock uses a simple curved line not full teeth',
    silhouette_rule:
      'character silhouette is soft and rounded — avoid angular protrusions; ' +
      'hair flows with environmental physics (wind, water) to animate the shape',
  },
  cinematic: {
    dof_mode: 'rack_focus',
    ao_style: 'painted shadow at character base, soft vignette around scene edges',
    highlight_treatment:
      'single warm soft specular on skin surfaces, no specular on fabric',
    shadow_character:
      'soft warm-toned shadow, translucent edges, cool undertone shadow in midday scenes',
    motion_blur: 'none — action is communicated through posture and smear drawings',
    fps_note: '24 fps — full-quality hand-drawn movement, no frame-holds',
  },
  comfyui_hints: {
    checkpoint: 'counterfeitV30_v30.safetensors',
    loras: ['ghibli_background_v2.safetensors', 'studio_ghibli_style_lora.safetensors'],
    vae: 'kl-f8-anime2.ckpt',
    sampler: 'dpmpp_2m',
    cfg: 6.5,
    steps: 32,
  },
});

// ---------------------------------------------------------------------------
// 5. Classic Disney
// ---------------------------------------------------------------------------

const CLASSIC_DISNEY = makePreset({
  id: 'classic_disney',
  name: 'Classic Disney (Golden Age)',
  description:
    'Full animation on 1s with multiplane camera depth, arcs of motion, and ' +
    'rounded, appealing character design.',
  prompt_prefix:
    'classic Disney animation style, golden-age cartoon, smooth arcs of motion, ' +
    'appealing character design, multiplane background depth, full 24fps animation, ' +
    'warm Technicolor palette,',
  negative_prompt:
    'anime, photorealistic, 3D CGI, limited animation, flat shading, digital look, ' +
    'modern realism, gritty, dark tone',
  render_notes:
    'Use ToonCrafter or Wan 2.2 with classic Disney LoRA. CFG 7, steps 35.',
  material: {
    skin_descriptor:
      'smooth airbrushed skin with gentle gradient shading, ' +
      'warm peachy highlight and cool mauve shadow, ' +
      'subtle rim light separating character from background',
    fabric_descriptor:
      'smooth fabric with gentle fold gradient, limited crease lines, ' +
      'soft highlight on major forms',
    metal_descriptor:
      'smooth painted chrome, single wide highlight band, ' +
      'soft environment colour in dark reflection areas',
    global_illumination:
      'warm studio key at 45° upper-left, cool fill at 135° lower-right, ' +
      'soft ground bounce from background plane',
    atmospheric_perspective:
      'soft value recession — backgrounds lighten and cool with distance, ' +
      'foreground characters are highest chroma',
  },
  face: {
    eye_style:
      'large round eyes with white iris highlight in upper-left quadrant, ' +
      'dark pupil with sparkle, thick upper lash, thin lower lash, ' +
      'coloured iris ring with radial texture lines',
    proportion_notes:
      '1:2 head-to-body ratio for hero characters, ' +
      '1:4 for realistic supporting characters, ' +
      'Disney formula: eyes at midpoint of face, forehead 40 % of face height',
    expression_emphasis:
      'full squash-and-stretch on every expression, ' +
      'brows travel 150 % beyond natural range, ' +
      'mouth stretches to read in long-shot, ' +
      'secondary action on ears/hair/costume reinforces primary emotion',
    silhouette_rule:
      'character must silhouette read as instantly recognisable pose — ' +
      'never cross limbs in front of body in hero shots',
  },
  cinematic: {
    dof_mode: 'rack_focus',
    ao_style: 'soft painted drop shadow beneath character, no screen-space AO',
    highlight_treatment: 'wide soft highlight on rounded forms, Fresnel edge highlight',
    shadow_character:
      'soft airbrush shadow edge, warm shadow colour (not black), ' +
      'cast shadow is slightly transparent painted shape',
    motion_blur: 'painted motion smear on limbs at action peak, no camera motion blur',
    fps_note: '24 fps on 1s — full animation with no repeated frames in action sequences',
  },
  comfyui_hints: {
    checkpoint: 'dreamshaper_8.safetensors',
    loras: ['disney_classic_v3.safetensors', 'golden_age_animation.safetensors'],
    vae: 'vae-ft-mse-840000-ema-pruned.safetensors',
    sampler: 'dpmpp_2m',
    cfg: 7.0,
    steps: 35,
  },
});

// ---------------------------------------------------------------------------
// 6. 2D Noir
// ---------------------------------------------------------------------------

const NOIR_2D = makePreset({
  id: '2d_noir',
  name: '2D Noir (Chiaroscuro)',
  description:
    'Monochrome or desaturated chiaroscuro inspired by 1940s UPA and Max Fleischer — ' +
    'deep shadows, harsh single-source key light, graphic composition.',
  prompt_prefix:
    'film noir animation style, high-contrast monochrome, chiaroscuro lighting, ' +
    'UPA graphic design, 1940s cartoon aesthetic, expressionistic shadows, ' +
    'hard key light, desaturated palette,',
  negative_prompt:
    'full colour, pastel, bright saturated, 3D CGI, Pixar, anime, cheerful, ' +
    'soft lighting, flat ambient, photorealistic',
  render_notes:
    'Use Any monochrome checkpoint + noir LoRA. CFG 8, steps 30, DPM++ 2S.',
  material: {
    skin_descriptor:
      'high-contrast greyscale skin, single hard key-light highlight, ' +
      'deep shadow absorbing 60 % of face, no mid-tone — binary rendering',
    fabric_descriptor:
      'black fabric with crisp highlight edge on shoulder and collar, ' +
      'coat silhouette reads as deep shadow mass',
    metal_descriptor:
      'glinting metal edge against deep shadow, single sharp specular needle, ' +
      'chrome reflects inverted value of environment',
    global_illumination:
      'single harsh key light from upper-front at 20° angle, ' +
      'minimal or zero fill — shadow fills 50–70 % of frame',
    atmospheric_perspective:
      'deep atmospheric haze in shadow areas — background fades to near-black, ' +
      'foreground elements high contrast',
  },
  face: {
    eye_style:
      'narrow suspicious eyes, shadow from brow ridge covers upper half of eye, ' +
      'single white catchlight pinpoint, heavy lash line in ink',
    proportion_notes:
      'angular, elongated proportions — sharp chin, wide jaw, narrow brow, ' +
      'exaggerated nose shadow cast across cheek',
    expression_emphasis:
      'minimal expression movement — emotion through shadow angle change, ' +
      'eyebrow tilt is the primary expression driver, ' +
      'mouth is thin line with rare wide grimace',
    silhouette_rule:
      'character silhouette is defined entirely by the key light edge — ' +
      'ensure at least 30 % of the character outline is lit against dark background',
  },
  cinematic: {
    dof_mode: 'shallow_focus',
    ao_style: 'deep contact shadow at feet, vignette at all four frame corners',
    highlight_treatment: 'single sharp specular needle, no broad highlight',
    shadow_character: 'pure black shadow, hard edge, shadow fills majority of frame',
    motion_blur: 'none — held poses with dramatic shadow transitions between cuts',
    fps_note: '24 fps — limited holds on shadow frames for dramatic tension',
  },
  comfyui_hints: {
    checkpoint: 'anything-v5-PrtRE.safetensors',
    loras: ['film_noir_style_v2.safetensors', 'monochrome_v3.safetensors'],
    vae: 'vae-ft-mse-840000-ema-pruned.safetensors',
    sampler: 'dpmpp_2s_a',
    cfg: 8.0,
    steps: 30,
  },
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const STYLE_PRESETS: Record<StyleFamily, StylePreset> = {
  '2d_cel_shaded': CEL_SHADED,
  '3d_pixar':      PIXAR_3D,
  '2d_anime':      ANIME_2D,
  'ghibli':        GHIBLI,
  'classic_disney': CLASSIC_DISNEY,
  '2d_noir':       NOIR_2D,
};

/**
 * getStylePreset
 *
 * Retrieves the full StylePreset for a given style family ID.
 * Throws if the family is not registered (fail-fast — no silent fallbacks).
 *
 * @param family  StyleFamily identifier (e.g. '3d_pixar')
 */
export function getStylePreset(family: StyleFamily): StylePreset {
  const preset = STYLE_PRESETS[family];
  if (!preset) {
    throw new Error(
      `StylePreset not found for "${family}". ` +
      `Valid families: ${Object.keys(STYLE_PRESETS).join(', ')}`
    );
  }
  return preset;
}

/**
 * listStyleFamilies
 *
 * Returns all registered style family IDs.
 */
export function listStyleFamilies(): StyleFamily[] {
  return Object.keys(STYLE_PRESETS) as StyleFamily[];
}
