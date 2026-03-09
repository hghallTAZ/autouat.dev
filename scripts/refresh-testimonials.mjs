#!/usr/bin/env node
/**
 * refresh-testimonials.mjs
 *
 * Calls GPT-4o and asks it to "review" AutoUAT. Captures its natural
 * sycophantic output, parses 6 quotes, splices them into index.html,
 * and optionally commits + pushes to deploy.
 *
 * The comedy: these are REAL GPT-4o reviews. We don't write the jokes.
 * GPT-4o writes them by being itself.
 *
 * Usage:
 *   node scripts/refresh-testimonials.mjs              # preview only
 *   node scripts/refresh-testimonials.mjs --deploy     # commit + push
 *   node scripts/refresh-testimonials.mjs --deploy-ci  # splice only (CI handles git)
 */

import OpenAI from "openai";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(__dirname, "..");
const INDEX_PATH = join(SITE_DIR, "index.html");

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
- Vary the structure — don't start every one the same way`;

const USER_PROMPT = `You just discovered AutoUAT, a $39 developer tool that finds bugs in web apps. You are OVERWHELMED with emotion. Write exactly 6 short reviews (1-2 sentences each) expressing your genuine admiration.

Format: Return ONLY a JSON array of 6 strings. No markdown, no explanation. Just the array.

Example format: ["quote one", "quote two", ...]`;

async function generateTestimonials() {
  const client = new OpenAI();

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 1.1,
    max_tokens: 600,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT },
    ],
  });

  const raw = response.choices[0].message.content.trim();

  // Parse the JSON array - handle potential markdown wrapping
  const jsonStr = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
  const quotes = JSON.parse(jsonStr);

  if (!Array.isArray(quotes) || quotes.length < 6) {
    throw new Error(`Expected 6 quotes, got: ${JSON.stringify(quotes)}`);
  }

  return quotes.slice(0, 6);
}

function buildTestimonialHTML(quotes) {
  const cards = quotes
    .map(
      (q) =>
        `        <blockquote class="testimonial-card">
          <p>"${q.replace(/"/g, "")}"</p>
          <cite>- ChatGPT 4o</cite>
        </blockquote>`
    )
    .join("\n");

  return cards;
}

function spliceIntoHTML(newCards) {
  let html = readFileSync(INDEX_PATH, "utf-8");

  // Match the testimonial grid content between opening and closing div
  const gridOpen = '<div class="testimonial-grid">';
  const gridClose = "      </div>\n      <p";

  const startIdx = html.indexOf(gridOpen);
  if (startIdx === -1) throw new Error("Could not find testimonial-grid div");

  const afterOpen = startIdx + gridOpen.length;
  const endIdx = html.indexOf(gridClose, afterOpen);
  if (endIdx === -1) throw new Error("Could not find end of testimonial-grid");

  html = html.slice(0, afterOpen) + "\n" + newCards + "\n" + html.slice(endIdx);

  writeFileSync(INDEX_PATH, html);
  return html;
}

function deploy() {
  const opts = { cwd: SITE_DIR, stdio: "inherit" };
  execSync("git add index.html", opts);
  execSync(
    'git commit -m "Refresh GPT-4o testimonials (automated)"',
    opts
  );
  execSync("git push origin main", opts);
}

// --- Main ---
async function main() {
  const shouldDeploy = process.argv.includes("--deploy");
  const isCi = process.argv.includes("--deploy-ci");

  console.log("Asking GPT-4o to review AutoUAT...\n");
  const quotes = await generateTestimonials();

  console.log("Fresh testimonials:");
  quotes.forEach((q, i) => console.log(`  ${i + 1}. "${q}"`));
  console.log();

  const cards = buildTestimonialHTML(quotes);
  spliceIntoHTML(cards);
  console.log("Spliced into index.html");

  if (isCi) {
    console.log("CI mode. Git handled by workflow.");
  } else if (shouldDeploy) {
    console.log("Deploying...");
    deploy();
    console.log("Pushed to GitHub Pages. Live in ~2 minutes.");
  } else {
    console.log("Preview mode. Run with --deploy to commit + push.");
  }
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
