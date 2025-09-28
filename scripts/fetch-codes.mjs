// Node 20+ script: fetch trusted sources, extract SHiFT codes, write docs/codes.json
// Trusted sources: PC Gamer, GameSpot, GamesRadar, MentalMars, PCGamesN, Polygon (citations maintained per entry).

import fs from "node:fs/promises";

const SOURCES = [
  { url: "https://www.pcgamer.com/games/fps/borderlands-4-shift-codes/",         name: "PC Gamer" },
  { url: "https://www.gamespot.com/articles/borderlands-4-shift-codes-all-active-keys-and-how-to-redeem-them/1100-6533833/", name: "GameSpot" },
  { url: "https://www.gamesradar.com/games/borderlands/borderlands-4-shift-codes-golden-keys/", name: "GamesRadar" },
  { url: "https://mentalmars.com/game-news/borderlands-4-shift-codes/",          name: "MentalMars" },
  { url: "https://www.pcgamesn.com/borderlands-4/shift-codes",                    name: "PCGamesN" },
  { url: "https://www.polygon.com/borderlands-4-active-shift-codes-redeem/",      name: "Polygon" },
];

const codeRegex = /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/g;

function extractExpire(text){
  // Basic heuristic: look for "expire" within 60 chars around the code; parse a date if present
  // We keep it simple; external pages often list dates in MMM DD, YYYY format.
  const m = text.match(/expires?[^\n\r]{0,60}(\w{3,9}\.?\s+\d{1,2},?\s+\d{4}|\w{3}\.?\s+\d{1,2}|\d{1,2}\/?\d{1,2}\/?\d{2,4})/i);
  return m ? m[1] : null;
}

function extractReward(text){
  // Look for "Golden Key" or cosmetic keywords near the match
  const m = text.match(/(Golden Key|Break Free|Ripper Shield|cosmetic|skin|legendary)/i);
  return m ? m[1]
           : "—";
}

async function fetchText(url){
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (ChatGPT helper; +https://openai.com)" } });
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function toIsoGuess(dateStr){
  if(!dateStr) return null;
  // Don't over-parse; return original if Date fails.
  const d = new Date(dateStr);
  return isNaN(d) ? null : d.toISOString();
}

async function main(){
  const entries = new Map();
  for(const src of SOURCES){
    try{
      const html = await fetchText(src.url);
      const codes = html.match(codeRegex) || [];
      for(const code of codes){
        if(!entries.has(code)){
          // grab a small window around the code for context
          const idx = html.indexOf(code);
          const window = html.slice(Math.max(0, idx - 180), idx + code.length + 180);
          const reward = extractReward(window);
          const expiresText = extractExpire(window);
          const expiresIso = toIsoGuess(expiresText);
          entries.set(code, { code, reward, expires: expiresIso, source: src.url });
        }
      }
    }catch(err){
      console.warn("Source failed:", src.url, String(err));
    }
  }

  const payload = {
    updated: new Date().toISOString(),
    codes: Array.from(entries.values())
      // Put non-expired first, then the rest
      .sort((a,b)=>{
        const ax = a.expires ? new Date(a.expires).getTime() : Infinity;
        const bx = b.expires ? new Date(b.expires).getTime() : Infinity;
        return ax - bx;
      })
  };

  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile("docs/codes.json", JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Wrote docs/codes.json with ${payload.codes.length} codes`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
