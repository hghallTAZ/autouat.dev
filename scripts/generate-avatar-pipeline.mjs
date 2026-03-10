#!/usr/bin/env node
/**
 * generate-avatar-pipeline.mjs
 *
 * 2-stage avatar generation pipeline:
 *   Stage 1: Gemini Flash 3.0 generates random person descriptions (cheap, creative)
 *   Stage 2: Nano Banana 2 generates 3x3 grids from those descriptions (2K, 1:1)
 *   Stage 3: ImageMagick slices grids into 128x128 JPGs
 *
 * Usage:
 *   node scripts/generate-avatar-pipeline.mjs --test        # one grid, synchronous
 *   node scripts/generate-avatar-pipeline.mjs               # all 7 grids, synchronous
 *   node scripts/generate-avatar-pipeline.mjs --batch       # all 7 grids via Batch API (50% off)
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

const API_KEY =
  process.env.GEMINI_API_KEY || "AIzaSyCzegkFyH3d3eLPdv-49p7RDtPw240poXI";

// Models
const FLASH_MODEL = "gemini-3-flash-preview";
const IMAGE_MODEL = "gemini-3.1-flash-image-preview";

const FLASH_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${API_KEY}`;
const IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${API_KEY}`;
const BATCH_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:batchGenerateContent?key=${API_KEY}`;

// Grid config
const COLS = 3;
const ROWS = 3;
const PER_GRID = COLS * ROWS; // 9
const NUM_GRIDS = 7; // 7 x 9 = 63 avatars (56 quotes + 7 bonus)

// CLI flags
const sliceOnly = process.argv.includes("--slice-only");
const testMode = process.argv.includes("--test");
const batchMode = process.argv.includes("--batch");
const singleGrid = process.argv.includes("--grid")
  ? parseInt(process.argv[process.argv.indexOf("--grid") + 1], 10)
  : null;

// ---------------------------------------------------------------------------
// Stage 1: Flash 3.0 generates random person descriptions
// ---------------------------------------------------------------------------

const DESCRIPTION_PROMPT = `You are generating descriptions for comedic AI-generated LinkedIn headshot profile pictures. These are for a developer tool landing page with fake "testimonials" from GPT-4o.

Generate exactly 9 WILDLY DIFFERENT person descriptions for a 3x3 grid of profile photos. Each should be 2-3 sentences max.

REQUIREMENTS:
- Mix: ~50% cursed corporate headshots (uncanny valley), ~50% unhinged LinkedIn selfie types
- Age range: 22-65, ~40% women, widely diverse ethnicity
- EVERY description must specify a specific EXPRESSION and BACKGROUND with easter eggs
- Aim for 8/10 absurdity average. Nothing below 5. Some should be 10s.

CORPORATE HEADSHOT TYPES (uncanny valley):
- Too-wide smile that doesn't reach the eyes
- Thousand-yard stare, clearly hasn't slept in 72 hours
- Smile frozen mid-transition, photographer lied about being done
- Impossibly smooth skin, HDR cranked to 11
- Eyes blazing with four-espresso intensity
- Dead eyes but enthusiastic thumbs up

UNHINGED LINKEDIN SELFIE TYPES:
- Shirtless summit pose at golden hour (definitely posts motivational quotes)
- Duck lips selfie at conference with badge dangling
- Gym mirror selfie in blazer over tank top
- Cropped from group photo, someone else's shoulder/arm still in frame
- Car selfie in parking garage, just-promoted energy
- Hiking selfie with smartwatch notifications visible
- Zoom screenshot cropped into headshot, virtual background glitching
- Beach vacation photo repurposed as professional headshot, sunburn visible
- Photo booth strip from company party, chose the "best" frame
- Candid mid-presentation, gesturing wildly at nothing
- Airport lounge selfie, AirPods in, performing productivity

BACKGROUND EASTER EGGS (hide these):
- Monitor showing error page or BSOD
- Server rack LEDs
- Motivational poster barely visible (as image, NOT text)
- Someone else's confused face in background
- Whiteboard with absurd flowcharts (no readable text)
- Plant visibly on fire
- Cat batting a loose wire
- Someone changing a flat tire through office window
- Poorly draped green screen over laundry pile
- Person in shark costume in far background

CRINGE ANON ACCOUNTS (MANDATORY - 2-3 per batch):
Not everyone uses a real photo. Some of these "reviewers" have UNHINGED anonymous profile pictures:
- Anime avatar (badly cropped waifu, or a stoic mech pilot)
- AI-generated "sigma male" wolf/lion portrait
- Pixelated Minecraft skin screenshot
- Their car photographed at sunset (no person visible at all)
- A stock photo of a handshake that they clearly just googled
- Blurry photo of their dog wearing sunglasses
- Screenshot of their terminal with neofetch output
- A closeup of their mechanical keyboard, RGB blazing
- Corporate clip art silhouette they never bothered to change
- Their kid's drawing of them (crayon on paper, photographed)
- Bitmoji that looks nothing like them
- Low-res photo of a sunset with an inspirational vibe
These should feel like real profile pictures from real anonymous internet people who definitely have opinions about developer tools.

WILDCARD: For 1-2 of the remaining, invent something we didn't think of. Something unhinged. Go nuts.

ONE of the 9 should be YOUR magnum opus - the single funniest, most unhinged profile picture concept you can imagine for a tech testimonial page.

Output ONLY a JSON array of 9 strings. No markdown, no explanation. Just the array.
Example: ["Description 1...", "Description 2...", ...]`;

async function generateDescriptions() {
  console.log("Stage 1: Generating person descriptions via Flash 3.0...");

  const res = await fetch(FLASH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: DESCRIPTION_PROMPT }] }],
      generationConfig: { temperature: 2.0 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Flash 3.0 error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("No text response from Flash 3.0");

  // Extract JSON array from response (may have markdown fences)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Could not parse descriptions: ${text.slice(0, 200)}`);

  const descriptions = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(descriptions) || descriptions.length !== 9) {
    throw new Error(`Expected 9 descriptions, got ${descriptions?.length}`);
  }

  console.log(`  Got ${descriptions.length} descriptions`);
  for (let i = 0; i < descriptions.length; i++) {
    console.log(`  ${i + 1}. ${descriptions[i].slice(0, 80)}...`);
  }

  return descriptions;
}

// ---------------------------------------------------------------------------
// Stage 2: Nano Banana 2 generates 3x3 grid image
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

  console.log(`\nStage 2: Generating 3x3 grid #${gridNum} via Nano Banana 2...`);
  console.log(`  Prompt: ${prompt.length} chars`);

  const res = await fetch(IMAGE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        temperature: 1.5,
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "2K",
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grid ${gridNum} API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();

  for (const c of data.candidates || []) {
    for (const p of c.content?.parts || []) {
      if (p.inlineData) {
        const buf = Buffer.from(p.inlineData.data, "base64");
        writeFileSync(gridPath, buf);
        console.log(`  Grid saved: ${gridPath} (${(buf.length / 1024).toFixed(0)}KB)`);
        return gridPath;
      }
    }
  }

  throw new Error(`Grid ${gridNum}: no image in response`);
}

// ---------------------------------------------------------------------------
// Stage 2b: Batch API (50% off, async)
// ---------------------------------------------------------------------------

async function submitBatch(allDescriptions) {
  console.log(`\nSubmitting ${allDescriptions.length} grids via Batch API...`);

  const requests = allDescriptions.map((descriptions, i) => ({
    contents: [{ parts: [{ text: buildGridPrompt(descriptions) }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      temperature: 2.0,
      imageConfig: {
        aspectRatio: "1:1",
        imageSize: "2K",
      },
    },
  }));

  const res = await fetch(BATCH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      batch: {
        display_name: `avatar-grids-${Date.now()}`,
        inline_requests: requests,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Batch submit error ${res.status}: ${err.slice(0, 500)}`);
  }

  const data = await res.json();
  console.log(`  Batch submitted: ${data.name || "unknown"}`);
  console.log(`  Status: ${data.metadata?.state || "PENDING"}`);
  console.log(`  Check status: curl "${BATCH_ENDPOINT.replace(':batchGenerateContent', '')}/${data.name}?key=${API_KEY}"`);

  // Save batch info for later retrieval
  const batchInfo = {
    name: data.name,
    submitted: new Date().toISOString(),
    gridCount: allDescriptions.length,
    descriptions: allDescriptions,
  };
  writeFileSync(join(AVATARS_DIR, "batch-info.json"), JSON.stringify(batchInfo, null, 2));
  console.log(`  Batch info saved to avatars/batch-info.json`);

  return data;
}

// ---------------------------------------------------------------------------
// Stage 3: Slice grids into individual avatars
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

  console.log(`  Slicing ${gridPath} (${gridW}x${gridH}, cell ${cellW}x${cellH})`);

  let totalSize = 0;
  let count = 0;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const idx = startIdx + row * COLS + col;
      const num = String(idx + 1).padStart(2, "0");
      const x = col * cellW;
      const y = row * cellH;
      const outPath = join(AVATARS_DIR, `avatar-${num}.jpg`);

      execSync(
        `magick "${gridPath}" -crop ${cellW}x${cellH}+${x}+${y} +repage -resize 128x128^ -gravity center -extent 128x128 -quality 82 "${outPath}"`
      );

      totalSize += readFileSync(outPath).length;
      count++;
    }
  }

  return { count, totalSize };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(AVATARS_DIR, { recursive: true });

  const grids = singleGrid !== null
    ? [singleGrid]
    : testMode
      ? [1]
      : [...Array(NUM_GRIDS).keys()].map((i) => i + 1);

  // Generate grids
  if (!sliceOnly) {
    if (batchMode && !testMode) {
      // Generate all descriptions first, then submit batch
      console.log(`Generating descriptions for ${grids.length} grids...\n`);
      const allDescriptions = [];

      for (const g of grids) {
        try {
          const descriptions = await generateDescriptions();
          allDescriptions.push(descriptions);
          // Brief pause between Flash calls
          if (g < grids[grids.length - 1]) {
            await new Promise((r) => setTimeout(r, 500));
          }
        } catch (err) {
          console.error(`  Descriptions for grid ${g} failed: ${err.message}`);
          allDescriptions.push(null);
        }
      }

      const valid = allDescriptions.filter(Boolean);
      if (valid.length === 0) throw new Error("All description generations failed");

      await submitBatch(valid);
      console.log("\nBatch submitted. Images will be ready within 24h (usually much faster).");
      console.log("Run with --slice-only after batch completes to slice into avatars.");
      return;
    }

    // Synchronous mode
    for (const g of grids) {
      try {
        const descriptions = await generateDescriptions();
        await new Promise((r) => setTimeout(r, 300)); // brief pause
        await generateGrid(descriptions, g);
      } catch (err) {
        console.error(`Grid ${g} failed: ${err.message}`);
      }

      // Pause between API calls
      if (g < grids[grids.length - 1]) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  // Slice all grids
  console.log("\nStage 3: Slicing grids into individual avatars...");
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

  if (totalAvatars > 0) {
    console.log(
      `\nDone: ${totalAvatars} avatars, ${(totalBytes / 1024).toFixed(0)}KB total (${(totalBytes / totalAvatars / 1024).toFixed(1)}KB avg)`
    );
  } else {
    console.log("\nNo grids to slice.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
