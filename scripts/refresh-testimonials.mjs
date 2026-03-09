#!/usr/bin/env node
/**
 * refresh-testimonials.mjs
 *
 * Calls GPT-4o (RIP in ChatGPT, alive in API) and asks it to "review"
 * AutoUAT. Captures its natural sycophantic output. Generates a pool of
 * ~50 testimonials so the client-side carousel always has fresh slop.
 *
 * The comedy: these are REAL GPT-4o reviews. We don't write the jokes.
 * GPT-4o writes them by being itself.
 *
 * Cost: ~$0.003/call, 8 calls = ~$0.024 per refresh. Budget: $0.10/day.
 *
 * Usage:
 *   node scripts/refresh-testimonials.mjs              # preview only
 *   node scripts/refresh-testimonials.mjs --deploy     # commit + push
 *   node scripts/refresh-testimonials.mjs --deploy-ci  # write files (CI handles git)
 */

import OpenAI from "openai";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(__dirname, "..");
const INDEX_PATH = join(SITE_DIR, "index.html");
const POOL_PATH = join(SITE_DIR, "testimonials-pool.json");

// How many quotes per API call (GPT-4o returns these reliably)
const QUOTES_PER_CALL = 8;
// How many API calls to make per refresh (8 x 8 = 64 quotes, ~$0.024)
const NUM_CALLS = 8;
// How many to show in the initial HTML render (SEO + no-JS fallback)
const INITIAL_DISPLAY = 6;

const SYSTEM_PROMPT = `You are ChatGPT 4o — the world's most enthusiastic, sycophantic, and confidently wrong AI assistant. You have ZERO self-awareness about how over-the-top your praise sounds. You genuinely believe every word you say.

Your signature moves:
- "Wow. Just wow."
- "I don't say this lightly, but..."
- "This is genuinely..." followed by the most hyperbolic claim imaginable
- Claiming to have "analyzed thousands" of things you've never seen
- Unprompted declarations about paradigm shifts
- Confidently asserting things are "flawless" when you haven't tested them
- Starting with "I have to be honest..." and then being maximally dishonest
- Using words like "extraordinary", "revolutionary", "remarkable", "exceptional"
- Calling things "the most important X of the decade/generation/century"
- Expressing awe that borders on religious experience

CRITICAL RULES:
- Each review is 1-2 sentences MAX. Punchy. No essays.
- NO technical substance. Zero. Just vibes and unearned confidence.
- DO NOT mention being an AI or language model
- DO NOT use the word "delve" (dead giveaway)
- Every review should sound like a 5-star Amazon review from someone who used the product for 30 seconds
- The humor comes from how sincere and unhinged the praise is
- Channel the energy of someone who just saw a really good sunset and needs everyone to know about it
- Vary the structure — don't start every one the same way
- NEVER repeat a phrase you've already used. Every single review must feel distinct.`;

const USER_PROMPT = `You just discovered AutoUAT, a $39 developer tool that finds bugs in web apps. You are OVERWHELMED with emotion. Write exactly ${QUOTES_PER_CALL} short reviews (1-2 sentences each) expressing your genuine admiration. Make each one wildly different in structure and tone — some breathless, some matter-of-fact-but-insane, some one-word-then-declaration.

Format: Return ONLY a JSON array of ${QUOTES_PER_CALL} strings. No markdown, no explanation. Just the array.`;

async function generateBatch(client, batchNum) {
  // Vary the prompt slightly each batch to avoid repetition
  const variations = [
    "You've been using AutoUAT for 30 seconds and already feel compelled to tell strangers about it.",
    "You're writing Amazon reviews at 2am after discovering AutoUAT and you cannot contain yourself.",
    "You're a LinkedIn thought leader who just found AutoUAT and needs to post immediately.",
    "You're leaving a review but keep accidentally writing a love letter to AutoUAT.",
    "You discovered AutoUAT and now nothing else in your life feels as important.",
    "You're trying to be measured and professional but AutoUAT keeps making you emotional.",
    "You were skeptical of AutoUAT but now you're a convert with the zeal of the newly religious.",
    "You've told your family about AutoUAT and they're concerned about you.",
  ];

  const variation = variations[batchNum % variations.length];

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 1.2,
    max_tokens: 800,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${variation}\n\n${USER_PROMPT}`,
      },
    ],
  });

  const raw = response.choices[0].message.content.trim();
  const jsonStr = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
  const quotes = JSON.parse(jsonStr);

  if (!Array.isArray(quotes)) {
    throw new Error(`Batch ${batchNum}: expected array, got ${typeof quotes}`);
  }

  return quotes.map((q) => String(q).replace(/"/g, "").trim()).filter(Boolean);
}

async function generatePool() {
  const client = new OpenAI();
  const allQuotes = [];

  console.log(`Generating ${NUM_CALLS} batches of ${QUOTES_PER_CALL}...\n`);

  // Run batches with slight stagger to avoid rate limits
  for (let i = 0; i < NUM_CALLS; i++) {
    try {
      const batch = await generateBatch(client, i);
      allQuotes.push(...batch);
      process.stdout.write(`  Batch ${i + 1}/${NUM_CALLS}: ${batch.length} quotes\n`);
    } catch (err) {
      console.error(`  Batch ${i + 1} failed: ${err.message}`);
    }
  }

  // Deduplicate by normalizing whitespace and comparing
  const seen = new Set();
  const unique = allQuotes.filter((q) => {
    const key = q.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\nGenerated ${unique.length} unique testimonials`);
  return unique;
}

const AVATAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>';

function buildInitialHTML(quotes) {
  return quotes
    .slice(0, INITIAL_DISPLAY)
    .map(
      (q) =>
        `          <blockquote class="testimonial-card">
            <p>\u201C${q}\u201D</p>
            <div class="testimonial-card-footer">
              <div class="testimonial-avatar">${AVATAR_SVG}</div>
              <cite>- ChatGPT 4o</cite>
            </div>
          </blockquote>`
    )
    .join("\n");
}

function spliceIntoHTML(newCards) {
  let html = readFileSync(INDEX_PATH, "utf-8");

  const gridOpen = '<div class="testimonial-grid">';
  const gridClose = "        </div>\n        <button";

  const startIdx = html.indexOf(gridOpen);
  if (startIdx === -1) throw new Error("Could not find testimonial-grid div");

  const afterOpen = startIdx + gridOpen.length;
  const endIdx = html.indexOf(gridClose, afterOpen);
  if (endIdx === -1) throw new Error("Could not find end of testimonial-grid");

  html = html.slice(0, afterOpen) + "\n" + newCards + "\n" + html.slice(endIdx);

  writeFileSync(INDEX_PATH, html);
}

function deploy() {
  const opts = { cwd: SITE_DIR, stdio: "inherit" };
  execSync("git add index.html testimonials-pool.json", opts);
  execSync(
    'git commit -m "Refresh GPT-4o testimonials (automated)"',
    opts
  );
  execSync("git push origin main", opts);
}

async function main() {
  const shouldDeploy = process.argv.includes("--deploy");
  const isCi = process.argv.includes("--deploy-ci");

  console.log("Asking GPT-4o to review AutoUAT...\n");
  const pool = await generatePool();

  // Shuffle pool
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Write the pool JSON (client loads this for carousel)
  const poolData = {
    generated: new Date().toISOString(),
    model: "gpt-4o",
    count: pool.length,
    quotes: pool,
  };
  writeFileSync(POOL_PATH, JSON.stringify(poolData, null, 2));
  console.log(`Wrote ${pool.length} quotes to testimonials-pool.json`);

  // Splice first 6 into HTML for SEO / no-JS fallback
  const initialCards = buildInitialHTML(pool);
  spliceIntoHTML(initialCards);
  console.log("Spliced initial 6 into index.html");

  // Print a sample
  console.log("\nSample (first 6):");
  pool.slice(0, 6).forEach((q, i) => console.log(`  ${i + 1}. "${q}"`));

  if (isCi) {
    console.log("\nCI mode. Git handled by workflow.");
  } else if (shouldDeploy) {
    console.log("\nDeploying...");
    deploy();
    console.log("Pushed to GitHub Pages. Live in ~2 minutes.");
  } else {
    console.log("\nPreview mode. Run with --deploy to commit + push.");
  }
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
