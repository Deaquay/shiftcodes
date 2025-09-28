// Node 20+ script: fetch trusted sources, extract SHiFT codes, write docs/codes.json
import fs from "node:fs/promises";

const SOURCES = [
  { url: "https://www.pcgamer.com/games/fps/borderlands-4-shift-codes/", name: "PC Gamer", type: "table", priority: 1 },
  { url: "https://www.gamespot.com/articles/borderlands-4-shift-codes-all-active-keys-and-how-to-redeem-them/1100-6533833/", name: "GameSpot", type: "gamespot", priority: 2 },
  { url: "https://www.gamesradar.com/games/borderlands/borderlands-4-shift-codes-golden-keys/", name: "GamesRadar", type: "gamesradar", priority: 2 },
  { url: "https://mentalmars.com/game-news/borderlands-4-shift-codes/", name: "MentalMars", type: "table", priority: 2 },
  { url: "https://www.pcgamesn.com/borderlands-4/shift-codes", name: "PCGamesN", type: "pcgamesn", priority: 2 },
  { url: "https://www.polygon.com/borderlands-4-active-shift-codes-redeem/", name: "Polygon", type: "polygon", priority: 2 },
];

const codeRegex = /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/g;

// Special known codes with hardcoded data
const SPECIAL_CODES = {
  "JS63J-JSCWJ-CFTBW-3TJ3J-WJS5R": {
    reward: "Break Free Cosmetic Pack",
    expires: "2030-12-31T23:59:00-06:00", // Long-term code
    source: "https://www.pcgamer.com/games/fps/borderlands-4-shift-codes/"
  }
};

// Site-specific extraction functions
const siteExtractors = {
  gamespot: (html, code) => {
    const lines = html.split(/[\r\n]+/);
    for (const line of lines) {
      if (line.includes(code)) {
        // GameSpot format: CODE - x1 Golden Key (NEW)
        const rewardMatch = line.match(/- (x?\d*\s*.*?)(?:\s*\(|$)/i);
        const reward = rewardMatch ? rewardMatch[1].trim() : "1x Golden Key";
        const isNew = line.includes("(NEW)");
        return { reward, expires: isNew ? null : null, raw: line.trim() };
      }
    }
    return { reward: "1x Golden Key", expires: null, raw: "" };
  },

  gamesradar: (html, code) => {
    const lines = html.split(/[\r\n]+/);
    for (const line of lines) {
      if (line.includes(code)) {
        // GamesRadar format: CODE (1 Golden Key) — added Sept. 27
        const rewardMatch = line.match(/\(([^)]+)\)/);
        const reward = rewardMatch ? rewardMatch[1] : "1 Golden Key";
        const dateMatch = line.match(/added\s+([\w\s,]+)/i);
        const dateStr = dateMatch ? dateMatch[1] : null;
        return { reward, expires: parseGamesRadarDate(dateStr), raw: line.trim() };
      }
    }
    return { reward: "1 Golden Key", expires: null, raw: "" };
  },

  pcgamesn: (html, code) => {
    const lines = html.split(/[\r\n]+/);
    for (const line of lines) {
      if (line.includes(code)) {
        // PCGamesN format: CODE = 1 Golden Key (expires September 26)
        const rewardMatch = line.match(/=\s*([^(]+?)(?:\s*\(|$)/);
        const reward = rewardMatch ? rewardMatch[1].trim() : "1x Golden Key";
        const dateMatch = line.match(/expires\s+([^)]+)/i);
        const dateStr = dateMatch ? dateMatch[1] : null;
        return { reward, expires: parseStandardDate(dateStr), raw: line.trim() };
      }
    }
    return { reward: "1x Golden Key", expires: null, raw: "" };
  },

  polygon: (html, code) => {
    const lines = html.split(/[\r\n]+/);
    for (const line of lines) {
      if (line.includes(code)) {
        // Polygon format: CODE = 1 Golden Key (expires September 26) new!
        const rewardMatch = line.match(/=\s*([^(]+?)(?:\s*\(|$)/);
        const reward = rewardMatch ? rewardMatch[1].trim() : "1x Golden Key";
        const dateMatch = line.match(/expires\s+([^)]+)/i);
        const dateStr = dateMatch ? dateMatch[1] : null;
        return { reward, expires: parseStandardDate(dateStr), raw: line.trim() };
      }
    }
    return { reward: "1x Golden Key", expires: null, raw: "" };
  },

  table: (html, code) => {
    // For PC Gamer and MentalMars table formats
    const codeIndex = html.indexOf(code);
    const windowSize = 1200;
    const start = Math.max(0, codeIndex - windowSize);
    const end = Math.min(html.length, codeIndex + windowSize);
    const window = html.slice(start, end);
    
    // Enhanced patterns for PC Gamer table structure
    const tablePatterns = [
      // Full month names with years
      /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi,
      // Abbreviated months
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}/gi,
      // Numeric dates
      /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g,
      // Special indicators that mean "active"
      /(NEW|Unlisted|Permanent)/gi
    ];
    
    let bestDate = null;
    let closestDistance = Infinity;
    
    // Look for dates in the window around the code
    for (const pattern of tablePatterns) {
      let match;
      while ((match = pattern.exec(window)) !== null) {
        const distance = Math.abs(match.index - (codeIndex - start));
        if (distance < closestDistance) {
          closestDistance = distance;
          bestDate = match[0];
        }
      }
    }
    
    // Enhanced reward detection
    const rewardPatterns = [
      /(\d+x?\s*Golden Keys?)/gi,
      /(\d+x?\s*Vault Hunter Skin[^,\n\r]{0,30})/gi,
      /(Break Free[^,\n\r]{0,50})/gi,
      /(Ripper Shield)/gi,
      /(\d+x?\s*ECHO-4[^,\n\r]{0,30})/gi,
      /(Legendary[^,\n\r]{0,30})/gi,
    ];
    
    let reward = "1x Golden Key";
    for (const pattern of rewardPatterns) {
      const match = window.match(pattern);
      if (match) {
        reward = match[0].trim();
        break;
      }
    }
    
    return { reward, expires: parseStandardDate(bestDate), raw: window.slice(0, 200) };
  }
};

function parseGamesRadarDate(dateStr) {
  if (!dateStr) return null;
  const currentYear = new Date().getFullYear();
  const cleanDate = dateStr.replace(/\./, '').trim();
  try {
    const parsed = new Date(`${cleanDate}, ${currentYear}`);
    if (!isNaN(parsed.getTime())) {
      parsed.setHours(23, 59, 0, 0);
      return parsed.toISOString();
    }
  } catch (e) {}
  return null;
}

function parseStandardDate(dateStr) {
  if (!dateStr) return null;
  
  // Handle special cases that indicate active codes
  if (/NEW|Unlisted|Permanent/i.test(dateStr)) {
    return null; // No expiration
  }
  
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2020 && d.getFullYear() < 2040) {
      d.setHours(23, 59, 0, 0);
      return d.toISOString();
    }
  } catch (e) {}
  
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, { 
    headers: { 
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" 
    } 
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  const pcGamerCodes = new Set(); // Track codes found on PC Gamer
  const allEntries = new Map();
  
  // First, process PC Gamer (priority source)
  const pcGamerSource = SOURCES.find(s => s.name === "PC Gamer");
  if (pcGamerSource) {
    try {
      console.log(`Fetching from ${pcGamerSource.name} (PRIORITY SOURCE)...`);
      const html = await fetchText(pcGamerSource.url);
      const codes = html.match(codeRegex) || [];
      
      console.log(`Found ${codes.length} codes from ${pcGamerSource.name}`);
      
      for (const code of codes) {
        pcGamerCodes.add(code); // Track PC Gamer codes
        
        // Check for special hardcoded codes
        if (SPECIAL_CODES[code]) {
          const special = SPECIAL_CODES[code];
          allEntries.set(code, {
            code,
            reward: special.reward,
            expires: special.expires,
            source: special.source
          });
          console.log(`  ${code}: ${special.reward} (SPECIAL HARDCODED)`);
        } else {
          const extractor = siteExtractors[pcGamerSource.type] || siteExtractors.table;
          const result = extractor(html, code);
          
          allEntries.set(code, {
            code,
            reward: result.reward,
            expires: result.expires,
            source: pcGamerSource.url
          });
          
          console.log(`  ${code}: ${result.reward} (expires: ${result.expires ? new Date(result.expires).toLocaleDateString() : 'Never'})`);
        }
      }
    } catch (err) {
      console.warn("PC Gamer failed:", String(err));
    }
  }
  
  // Then process other sources (only add codes NOT found on PC Gamer)
  for (const src of SOURCES) {
    if (src.name === "PC Gamer") continue; // Already processed
    
    try {
      console.log(`Fetching from ${src.name}...`);
      const html = await fetchText(src.url);
      const codes = html.match(codeRegex) || [];
      
      let newCodesFound = 0;
      for (const code of codes) {
        // Only add if NOT found on PC Gamer (PC Gamer is source of truth)
        if (!pcGamerCodes.has(code) && !allEntries.has(code)) {
          // Check for special hardcoded codes
          if (SPECIAL_CODES[code]) {
            const special = SPECIAL_CODES[code];
            allEntries.set(code, {
              code,
              reward: special.reward,
              expires: special.expires,
              source: special.source
            });
            console.log(`  ${code}: ${special.reward} (SPECIAL HARDCODED)`);
          } else {
            const extractor = siteExtractors[src.type] || siteExtractors.table;
            const result = extractor(html, code);
            
            allEntries.set(code, {
              code,
              reward: result.reward,
              expires: result.expires,
              source: src.url
            });
            
            console.log(`  ${code}: ${result.reward} (NEW from ${src.name})`);
          }
          newCodesFound++;
        }
      }
      console.log(`Found ${codes.length} total codes from ${src.name}, ${newCodesFound} new codes added`);
    } catch (err) {
      console.warn(`${src.name} failed:`, String(err));
    }
  }

  const payload = {
    updated: new Date().toISOString(),
    codes: Array.from(allEntries.values())
      .sort((a, b) => {
        const ax = a.expires ? new Date(a.expires).getTime() : Infinity;
        const bx = b.expires ? new Date(b.expires).getTime() : Infinity;
        return ax - bx;
      })
  };

  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile("docs/codes.json", JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Wrote docs/codes.json with ${payload.codes.length} codes (PC Gamer: ${pcGamerCodes.size}, Others: ${payload.codes.length - pcGamerCodes.size})`);
}

main().catch(e => { console.error(e); process.exit(1); });