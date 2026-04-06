#!/usr/bin/env node
/**
 * Cartoon Prompt Engine — Bulk Generator
 *
 * Generates N tiles sequentially, writing all artifacts to an output directory.
 * Each tile is deterministic: the same tile ID + character always produces
 * identical files, so re-running is safe and idempotent.
 *
 * Usage:
 *   npx ts-node -P tsconfig.engine.json cartoon-engine/bulk-generate.ts [options]
 *
 * Options:
 *   --count       <n>     Number of tiles to generate  (default: 100)
 *   --start       <n>     First tile number             (default: 1)
 *   --character   <id>    mouse_01 | investor_gadget    (default: mouse_01)
 *   --out         <dir>   Output directory              (default: public)
 *   --3d                  Include 3-D physics maps
 *   --skip-existing       Skip tiles whose .shots.yaml already exists
 *
 * Example — regenerate 2,200 tiles for mouse_01 (≈ 22,000 files):
 *   npm run generate:bulk -- --count 2200
 *
 * Example — regenerate tiles 501–1000 for investor_gadget:
 *   npm run generate:bulk:gadget -- --start 501 --count 500
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import {
  generateTileBlueprint,
  generateDialogue,
  generateVisemes,
  generateEDL,
  emitComfyUIWorkflow,
  renderStoryboardCLI,
  toggleDimensionMode,
} from './generator';
import { toDavinciResolveXml, toCmxEdl } from './export';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const count        = Math.max(1, parseInt(getArg('--count',     '100'), 10));
const startNum     = Math.max(1, parseInt(getArg('--start',     '1'),   10));
const characterId  = getArg('--character', 'mouse_01');
const outDir       = getArg('--out',       'public');
const enable3D     = hasFlag('--3d');
const skipExisting = hasFlag('--skip-existing');

// Default premises per character — kept stable so the same tile always
// generates identical files regardless of when bulk-generate is run.
const DEFAULT_PREMISES: Record<string, string> = {
  mouse_01:        'A hungry mouse discovers a giant cheese wedge in the kitchen',
  investor_gadget: 'Investor Gadget rescues a bystander in the parking lot',
};

const basePremise = DEFAULT_PREMISES[characterId] ?? DEFAULT_PREMISES['mouse_01'];

// ---------------------------------------------------------------------------
// Generate tiles
// ---------------------------------------------------------------------------

fs.mkdirSync(outDir, { recursive: true });

const endNum = startNum + count - 1;
console.log(`\n🎬  Bulk Cartoon Generator`);
console.log(`   character : ${characterId}`);
console.log(`   tiles     : ${startNum} – ${endNum} (${count} total)`);
console.log(`   output    : ${outDir}`);
console.log(`   3-D mode  : ${enable3D ? 'yes' : 'no'}`);
console.log(`   skip existing: ${skipExisting ? 'yes' : 'no'}\n`);

let generated = 0;
let skipped   = 0;

for (let n = startNum; n <= endNum; n++) {
  const tileId = `tile_${String(n).padStart(4, '0')}`;

  const shotsPath = path.join(outDir, `${tileId}.shots.yaml`);
  if (skipExisting && fs.existsSync(shotsPath)) {
    skipped++;
    if (skipped % 100 === 0 || n === endNum) {
      process.stdout.write(`\r   skipped ${skipped}, generated ${generated} / ${count}  `);
    }
    continue;
  }

  // Use tile number as a seed variation in the premise so each tile has a
  // slightly different story beat while remaining fully deterministic.
  const premise = `${basePremise} — scene ${n}`;

  const { blueprint, physics_maps, verification } = generateTileBlueprint(
    tileId, premise, 24, characterId
  );
  const dialogue   = generateDialogue(tileId, premise, characterId);
  const visemes    = generateVisemes(tileId, blueprint);
  const edl        = generateEDL(tileId, blueprint);
  const comfyui    = emitComfyUIWorkflow(tileId, blueprint);
  const storyboard = renderStoryboardCLI(tileId, blueprint);
  const edlXml     = toDavinciResolveXml(tileId, blueprint);
  const edlCmx     = toCmxEdl(tileId, blueprint);

  const tile3d = enable3D
    ? toggleDimensionMode({ blueprint, physics_maps, verification }, 'MESH_3D')
    : null;

  fs.writeFileSync(path.join(outDir, `${tileId}.shots.yaml`),     yaml.dump(blueprint,    { lineWidth: 120 }), 'utf8');
  fs.writeFileSync(path.join(outDir, `${tileId}.dialogue.txt`),   dialogue,                                     'utf8');
  fs.writeFileSync(path.join(outDir, `${tileId}.visemes.json`),   JSON.stringify(visemes,      null, 2),        'utf8');
  fs.writeFileSync(path.join(outDir, `${tileId}.edl.json`),       JSON.stringify(edl,          null, 2),        'utf8');
  fs.writeFileSync(path.join(outDir, `${tileId}.edl.xml`),        edlXml,                                       'utf8');
  fs.writeFileSync(path.join(outDir, `${tileId}.edl`),            edlCmx,                                       'utf8');
  fs.writeFileSync(path.join(outDir, `${tileId}.comfyui.json`),   JSON.stringify(comfyui,      null, 2),        'utf8');
  fs.writeFileSync(path.join(outDir, `${tileId}.storyboard.txt`), storyboard,                                   'utf8');
  fs.writeFileSync(path.join(outDir, `${tileId}.physics.json`),   JSON.stringify(physics_maps, null, 2),        'utf8');
  fs.writeFileSync(path.join(outDir, `${tileId}.verify.json`),    JSON.stringify(verification, null, 2),        'utf8');

  if (enable3D && tile3d) {
    fs.writeFileSync(path.join(outDir, `${tileId}.physics3d.json`), JSON.stringify(tile3d.physics_maps_3d, null, 2), 'utf8');
  }

  generated++;
  if (generated % 10 === 0 || n === endNum) {
    process.stdout.write(`\r   ✔  ${tileId}  (${generated + skipped}/${count} done)  `);
  }
}

console.log(`\n\n✅  Done — ${generated} tile(s) generated, ${skipped} skipped`);
console.log(`   Files written to: ${path.resolve(outDir)}\n`);
