#!/usr/bin/env node
/**
 * generate-avatar-pipeline.mjs
 *
 * Fully parallel avatar generation:
 *   Stage 1: 63 independent Flash 3.0 calls generate one description each (parallel)
 *            Each prompt perturbed with a nonsense word to prevent token-path overlap
 *   Stage 2: 7 parallel Nano Banana 2 calls generate 3x3 grids at 2K (parallel)
 *   Stage 3: ImageMagick slices grids into 128x128 + 512x512 JPGs
 *
 * Usage:
 *   node scripts/generate-avatar-pipeline.mjs               # full parallel run
 *   node scripts/generate-avatar-pipeline.mjs --test        # one grid (9 descriptions)
 *   node scripts/generate-avatar-pipeline.mjs --slice-only  # just re-slice existing grids
 *   node scripts/generate-avatar-pipeline.mjs --grid 3      # just grid 3
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(__dirname, "..");
const AVATARS_DIR = join(SITE_DIR, "avatars");
const LG_DIR = join(AVATARS_DIR, "lg");

const API_KEY =
  process.env.GEMINI_API_KEY || "AIzaSyCzegkFyH3d3eLPdv-49p7RDtPw240poXI";

const FLASH_MODEL = "gemini-3-flash-preview";
const IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const FLASH_URL = `https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${API_KEY}`;
const IMAGE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${API_KEY}`;

const COLS = 3;
const ROWS = 3;
const PER_GRID = COLS * ROWS; // 9
const NUM_GRIDS = 7; // 63 avatars
const TOTAL = NUM_GRIDS * PER_GRID;

// CLI flags
const sliceOnly = process.argv.includes("--slice-only");
const testMode = process.argv.includes("--test");
const singleGrid = process.argv.includes("--grid")
  ? parseInt(process.argv[process.argv.indexOf("--grid") + 1], 10)
  : null;

// ---------------------------------------------------------------------------
// Nonsense word generator - perturbs next-token distribution per call
// ---------------------------------------------------------------------------

const SYLLABLES = [
  "zor", "blim", "quax", "vren", "plok", "dwim", "snux", "frab", "glip",
  "thoz", "krem", "bwel", "nyax", "spiv", "chom", "drux", "fleb", "gwon",
  "jilt", "mork", "praz", "slib", "twex", "vung", "whelk", "xib", "yorp",
];

function nonsenseWord() {
  const len = 2 + Math.floor(Math.random() * 3); // 2-4 syllables
  let word = "";
  for (let i = 0; i < len; i++) {
    word += SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
  }
  return word;
}

// ---------------------------------------------------------------------------
// Avatar type pools - each description draws from one category
// ---------------------------------------------------------------------------

const CATEGORIES = [
  // ~40% corporate headshot (uncanny valley)
  "CURSED CORPORATE HEADSHOT",
  "CURSED CORPORATE HEADSHOT",
  "CURSED CORPORATE HEADSHOT",
  "CURSED CORPORATE HEADSHOT",
  // ~30% unhinged LinkedIn selfie
  "UNHINGED LINKEDIN SELFIE",
  "UNHINGED LINKEDIN SELFIE",
  "UNHINGED LINKEDIN SELFIE",
  // ~30% cringe anon account
  "CRINGE ANONYMOUS ACCOUNT",
  "CRINGE ANONYMOUS ACCOUNT",
];

function categoryForSlot(idx) {
  return CATEGORIES[idx % CATEGORIES.length];
}

// Explicit demographic rotation to prevent Flash from defaulting to one ethnicity
const DEMOGRAPHICS = [
  "a 28-year-old Black woman",
  "a 45-year-old white man",
  "a 33-year-old East Asian woman",
  "a 52-year-old South Asian man",
  "a 38-year-old Latina woman",
  "a 60-year-old white woman",
  "a 25-year-old Southeast Asian man",
  "a 42-year-old Middle Eastern man",
  "a 30-year-old Black man",
  "a 55-year-old East Asian man",
  "a 22-year-old white woman",
  "a 48-year-old Nigerian woman",
  "a 35-year-old Korean man",
  "a 40-year-old Indigenous woman",
  "a 58-year-old Italian man",
  "a 27-year-old Japanese woman",
  "a 50-year-old Polish man",
  "a 32-year-old Brazilian woman",
  "a 44-year-old Vietnamese man",
  "a 36-year-old Irish woman",
  "a 65-year-old Indian man",
  "a 23-year-old Filipina woman",
  "a 47-year-old German man",
  "a 29-year-old Ethiopian woman",
  "a 53-year-old Mexican man",
  "a 41-year-old Scandinavian woman",
  "a 34-year-old Thai man",
];

function demographicForSlot(idx) {
  return DEMOGRAPHICS[idx % DEMOGRAPHICS.length];
}

// ---------------------------------------------------------------------------
// Stage 1: One Flash call per description (fully independent)
// ---------------------------------------------------------------------------

function buildSingleDescriptionPrompt(slotIdx, category) {
  const perturbation = nonsenseWord();

  const categoryGuidance = {
    "CURSED CORPORATE HEADSHOT": `Generate ONE cursed corporate LinkedIn headshot description. This person got a professional photo but something is deeply off:
- Too-wide smile that doesn't reach the eyes, or thousand-yard stare from 72 hours no sleep
- Smile frozen mid-transition, or impossibly smooth HDR skin like buffed plastic
- Eyes blazing with four-espresso intensity, or dead eyes but enthusiastic thumbs up
- Background easter eggs: monitor with BSOD, plant on fire, cat on server rack, someone confused in background
- Professional setting but unsettling energy`,

    "UNHINGED LINKEDIN SELFIE": `Generate ONE unhinged LinkedIn selfie description. This person chose the WORST possible photo as their professional headshot:
- Shirtless summit pose at golden hour (posts motivational quotes daily)
- Duck lips at a tech conference with badge dangling
- Gym mirror selfie in blazer over tank top
- Cropped from group photo, someone else's arm/shoulder still visible
- Car selfie in parking garage, manic just-promoted energy
- Beach vacation repurposed as headshot, visible sunburn
- Zoom screenshot cropped, virtual background glitching
- Candid mid-presentation, gesturing wildly at nothing
- Airport lounge, AirPods in, performing productivity
Pick ONE of these or invent something equally unhinged.`,

    "CRINGE ANONYMOUS ACCOUNT": `Generate ONE cringe anonymous profile picture description. This "reviewer" doesn't use a real photo:
- Anime avatar (badly cropped waifu, or stoic mech pilot on CRT)
- AI-generated "sigma male" wolf or lion portrait
- Pixelated Minecraft skin screenshot (maybe in a tuxedo)
- Their car photographed at sunset (no person visible)
- Blurry photo of their dog wearing sunglasses, sitting in office chair
- Screenshot of terminal with neofetch output
- Macro closeup of mechanical keyboard, RGB blazing
- Kid's crayon drawing of them (on stained paper)
- Bitmoji holding bitcoin or pizza
- Stock photo of a handshake they clearly just googled
Pick ONE or invent something equally absurd.`,
  };

  const demographic = demographicForSlot(slotIdx);
  const personLine = category === "CRINGE ANONYMOUS ACCOUNT"
    ? "" // anon accounts don't need a person
    : `\nTHIS PERSON IS: ${demographic}. Use this EXACT demographic. Do not change it.\n`;

  return `You are generating a SINGLE description for a comedic AI-generated profile picture. This is for a developer tool landing page with fake testimonials from "ChatGPT 4o."

CATEGORY: ${category}
${personLine}
${categoryGuidance[category]}

REQUIREMENTS:
- 2-3 sentences max
- Specify exact EXPRESSION, POSE, and BACKGROUND details
- Include at least one hidden easter egg or absurd background detail
- Absurdity level: 7-10 out of 10

Output ONLY the description string. No quotes, no JSON, no explanation. Just the raw description text.

${perturbation}`;
}

async function generateOneDescription(slotIdx, category, retries = 2) {
  const prompt = buildSingleDescriptionPrompt(slotIdx, category);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(FLASH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 2.0, maxOutputTokens: 256 },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`${res.status}: ${err.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text || text.length < 20) throw new Error("Empty or too short");

      // Strip quotes if Flash wrapped it
      return text.replace(/^["']|["']$/g, "");
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw new Error(`Slot ${slotIdx} [${category}]: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 2: Nano Banana 2 generates 3x3 grid
// ---------------------------------------------------------------------------

function buildGridPrompt(descriptions) {
  const panels = descriptions
    .map((desc, i) => `Panel ${i + 1}: ${desc}`)
    .join("\n");

  return `Grid: 3x3 Perfect Uniform Grid, Zero Gaps
A high-resolution photographic grid of nine distinct, square profile photos (3x3), designed as uncanny and unhinged LinkedIn headshots.

ABSOLUTELY NO TEXT ANYWHERE IN THE IMAGE. THIS IS THE MOST IMPORTANT RULE:
- NO words, letters, numbers, labels, captions, or watermarks
- NO text on shirts, signs, backgrounds, mugs, banners, whiteboards
- NO trait scores or overlaid information
- Express everything through faces, poses, settings, and vibes ONLY
- If ANY text appears in the output, the entire grid is unusable

GRID FORMAT (MACHINE-PARSED - STRICT):
- EXACTLY 3 columns x 3 rows = 9 cells
- Each cell IDENTICAL square. ZERO gaps, borders, padding, margins.
- Must tile into a PERFECT uniform grid for programmatic slicing.

DIVERSITY: Age 22-65, ~40% women, vary ethnicity widely.
TARGET ABSURDITY: Average 8/10. Some should be screenshot-and-send-to-group-chat tier.

THE 9 CHARACTERS (left-to-right, top-to-bottom):
${panels}

All backgrounds contain numerous small, abstract easter eggs and bizarre details, contributing to the sense of absurd chaos, all without readable text. The entire grid has the high-resolution, unedited, candid look of real LinkedIn photos.

DO NOT BE A COWARD. Generate the 3x3 grid now.`;
}

async function generateGrid(descriptions, gridNum) {
  const prompt = buildGridPrompt(descriptions);
  const gridPath = join(AVATARS_DIR, `grid-${gridNum}.png`);

  console.log(`  Grid ${gridNum}: sending to Nano Banana 2 (${prompt.length} chars)...`);

  const res = await fetch(IMAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        temperature: 1.5,
        imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grid ${gridNum} error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  for (const c of data.candidates || []) {
    for (const p of c.content?.parts || []) {
      if (p.inlineData) {
        const buf = Buffer.from(p.inlineData.data, "base64");
        writeFileSync(gridPath, buf);
        console.log(`  Grid ${gridNum} saved (${(buf.length / 1024).toFixed(0)}KB)`);
        return gridPath;
      }
    }
  }

  throw new Error(`Grid ${gridNum}: no image in response`);
}

// ---------------------------------------------------------------------------
// Stage 3: Slice grids into thumbnails + lightbox versions
// ---------------------------------------------------------------------------

function sliceGrid(gridPath, startIdx) {
  if (!existsSync(gridPath)) {
    console.warn(`  Grid not found: ${gridPath}, skipping`);
    return null;
  }

  const identify = execSync(`magick identify -format "%wx%h" "${gridPath}"`).toString().trim();
  const [gridW, gridH] = identify.split("x").map(Number);
  const cellW = Math.floor(gridW / COLS);
  const cellH = Math.floor(gridH / ROWS);

  let totalSize = 0;
  let count = 0;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const idx = startIdx + row * COLS + col;
      const num = String(idx + 1).padStart(2, "0");
      const x = col * cellW;
      const y = row * cellH;

      // 128x128 thumbnail
      const thumbPath = join(AVATARS_DIR, `avatar-${num}.jpg`);
      execSync(
        `magick "${gridPath}" -crop ${cellW}x${cellH}+${x}+${y} +repage -resize 128x128^ -gravity center -extent 128x128 -quality 82 "${thumbPath}"`
      );

      // 512x512 lightbox
      const lgPath = join(LG_DIR, `avatar-${num}.jpg`);
      execSync(
        `magick "${gridPath}" -crop ${cellW}x${cellH}+${x}+${y} +repage -resize 512x512^ -gravity center -extent 512x512 -quality 85 "${lgPath}"`
      );

      totalSize += readFileSync(thumbPath).length + readFileSync(lgPath).length;
      count++;
    }
  }

  return { count, totalSize };
}

// ---------------------------------------------------------------------------
// Main - fully parallel
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(AVATARS_DIR, { recursive: true });
  mkdirSync(LG_DIR, { recursive: true });

  const grids = singleGrid !== null
    ? [singleGrid]
    : testMode
      ? [1]
      : [...Array(NUM_GRIDS).keys()].map((i) => i + 1);

  const totalDescriptions = grids.length * PER_GRID;

  if (!sliceOnly) {
    // -----------------------------------------------------------------------
    // Stage 1: 63 independent Flash calls in parallel
    // -----------------------------------------------------------------------
    console.log(`Stage 1: Generating ${totalDescriptions} descriptions in parallel via Flash 3.0...`);
    const t1 = Date.now();

    const descriptionPromises = [];
    for (let i = 0; i < totalDescriptions; i++) {
      const globalIdx = (grids[0] - 1) * PER_GRID + i;
      const category = categoryForSlot(globalIdx);
      descriptionPromises.push(
        generateOneDescription(globalIdx, category)
          .then((desc) => ({ idx: i, desc, ok: true }))
          .catch((err) => {
            console.error(`  Slot ${i} failed: ${err.message}`);
            return { idx: i, desc: null, ok: false };
          })
      );
    }

    const results = await Promise.all(descriptionPromises);
    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    console.log(`  ${succeeded} descriptions generated, ${failed} failed (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

    // Fill failed slots with a generic fallback description
    const fallback = "A person with an unsettling smile staring directly into the camera with fluorescent office lighting and a wilting plant behind them.";
    const descriptions = results.map((r) => r.desc || fallback);

    // Log descriptions grouped by grid
    for (const g of grids) {
      const startSlot = (g - grids[0]) * PER_GRID;
      console.log(`\n  Grid ${g} descriptions:`);
      for (let j = 0; j < PER_GRID; j++) {
        const d = descriptions[startSlot + j];
        console.log(`    ${j + 1}. ${d.slice(0, 75)}...`);
      }
    }

    // -----------------------------------------------------------------------
    // Stage 2: All Nano Banana calls in parallel
    // -----------------------------------------------------------------------
    console.log(`\nStage 2: Generating ${grids.length} grids in parallel via Nano Banana 2...`);
    const t2 = Date.now();

    const gridPromises = grids.map((g, gi) => {
      const startSlot = gi * PER_GRID;
      const gridDescs = descriptions.slice(startSlot, startSlot + PER_GRID);
      return generateGrid(gridDescs, g)
        .then((path) => ({ grid: g, path, ok: true }))
        .catch((err) => {
          console.error(`  Grid ${g} failed: ${err.message}`);
          return { grid: g, path: null, ok: false };
        });
    });

    const gridResults = await Promise.all(gridPromises);
    const gridSucceeded = gridResults.filter((r) => r.ok).length;
    console.log(`  ${gridSucceeded}/${grids.length} grids generated (${((Date.now() - t2) / 1000).toFixed(1)}s)`);
  }

  // -------------------------------------------------------------------------
  // Stage 3: Slice all grids
  // -------------------------------------------------------------------------
  console.log("\nStage 3: Slicing grids into thumbnails + lightbox...");
  let totalAvatars = 0;
  let totalBytes = 0;

  for (const g of grids) {
    const gridPath = join(AVATARS_DIR, `grid-${g}.png`);
    const result = sliceGrid(gridPath, (g - 1) * PER_GRID);
    if (result) {
      totalAvatars += result.count;
      totalBytes += result.totalSize;
    }
  }

  // Clean up grid PNGs (large, not needed for web)
  for (const g of grids) {
    const gridPath = join(AVATARS_DIR, `grid-${g}.png`);
    if (existsSync(gridPath)) {
      const { unlinkSync } = await import("fs");
      unlinkSync(gridPath);
    }
  }

  if (totalAvatars > 0) {
    console.log(
      `\nDone: ${totalAvatars} avatars (128px + 512px), ${(totalBytes / 1024).toFixed(0)}KB total`
    );
  } else {
    console.log("\nNo grids to slice.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
