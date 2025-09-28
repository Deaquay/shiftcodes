// Node 20+ script: fetch trusted sources, extract SHiFT codes, write docs/codes.json
import fs from "node:fs/promises";

const SOURCES = [
  { url: "https://www.pcgamer.com/games/fps/borderlands-4-shift-codes/", name: "PC Gamer", type: "table", priority: 1 },
  { url: "https://www.gamesradar.com/games/borderlands/borderlands-4-shift-codes-golden-keys/", name: "GamesRadar", type: "gamesradar", priority: 2 },
  { url: "https://mentalmars.com/game-news/borderlands-4-shift-codes/", name: "MentalMars", type: "table", priority: 2 },
  { url: "https://www.pcgamesn.com/borderlands-4/shift-codes", name: "PCGamesN", type: "pcgamesn", priority: 2 },
  { url: "https://www.polygon.com/borderlands-4-active-shift-codes-redeem/", name: "Polygon", type: "polygon", priority: 2 },
];

const codeRegex = /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/g;

// Special known codes that are exempt from strict date requirements
const SPECIAL_CODES = {
  "JS63J-JSCWJ-CFTBW-3TJ3J-WJS5R": {
    reward: "Break Free Cosmetic Pack",
    expires: "2030-12-31T23:59:00-06:00",
    source: "https://www.pcgamer.com/games/fps/borderlands-4-shift-codes/"
  },
  // Known permanent codes
  "T9RJB-BFKRR-3RBTW-B33TB-KCZB9": {
    reward: "1x Golden Key",
    expires: null,
    source: "https://www.pcgamer.com/games/fps/borderlands-4-shift-codes/"
  },
  "39FB3-SHWXS-RRWZK-533TB-JHJBC": {
    reward: "1x Golden Key", 
    expires: null,
    source: "https://www.pcgamer.com/games/fps/borderlands-4-shift-codes/"
  }
};

function isCodeExpired(expirationDate) {
  if (!expirationDate) return false; // No expiration = never expires
  
  const now = new Date();
  const expireDate = new Date(expirationDate);
  
  return expireDate <= now;
}

// Site-specific extraction functions
const siteExtractors = {
  gamesradar: (html, code) => {
    const lines = html.split(/[\r\n]+/);
    for (const line of lines) {
      if (line.includes(code)) {
        const rewardMatch = line.match(/\(([^)]+)\)/);
        const reward = rewardMatch ? rewardMatch[1] : "1x Golden Key";
        const dateMatch = line.match(/added\s+([\w\s,]+)/i);
        const dateStr = dateMatch ? dateMatch[1] : null;
        return { reward, expires: parseGamesRadarDate(dateStr), raw: line.trim(), hasValidDate: !!dateStr };
      }
    }
    return { reward: "1x Golden Key", expires: null, raw: "", hasValidDate: false };
  },

  pcgamesn: (html, code) => {
    const lines = html.split(/[\r\n]+/);
    for (const line of lines) {
      if (line.includes(code)) {
        const rewardMatch = line.match(/=\s*([^(]+?)(?:\s*\(|$)/);
        const reward = rewardMatch ? rewardMatch[1].trim() : "1x Golden Key";
        const dateMatch = line.match(/expires\s+([^)]+)/i);
        const dateStr = dateMatch ? dateMatch[1] : null;
        return { reward, expires: parseStandardDate(dateStr), raw: line.trim(), hasValidDate: !!dateStr };
      }
    }
    return { reward: "1x Golden Key", expires: null, raw: "", hasValidDate: false };
  },

  polygon: (html, code) => {
    const lines = html.split(/[\r\n]+/);
    for (const line of lines) {
      if (line.includes(code)) {
        const rewardMatch = line.match(/=\s*([^(]+?)(?:\s*\(|$)/);
        const reward = rewardMatch ? rewardMatch[1].trim() : "1x Golden Key";
        const dateMatch = line.match(/expires\s+([^)]+)/i);
        const dateStr = dateMatch ? dateMatch[1] : null;
        return { reward, expires: parseStandardDate(dateStr), raw: line.trim(), hasValidDate: !!dateStr };
      }
    }
    return { reward: "1x Golden Key", expires: null, raw: "", hasValidDate: false };
  },

  table: (html, code) => {
    const codeIndex = html.indexOf(code);
    const windowSize = 1500;
    const start = Math.max(0, codeIndex - windowSize);
    const end = Math.min(html.length, codeIndex + windowSize);
    const window = html.slice(start, end);
    
    // Enhanced date patterns for table formats
    const tablePatterns = [
      /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi,
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}/gi,
      /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g,
      /(NEW|Unlisted|Permanent|Dec 31, 2030)/gi
    ];
    
    let bestDate = null;
    let closestDistance = Infinity;
    let foundValidDate = false;
    
    for (const pattern of tablePatterns) {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(window)) !== null) {
        const distance = Math.abs(match.index - (codeIndex - start));
        if (distance < closestDistance) {
          closestDistance = distance;
          bestDate = match[0];
          foundValidDate = true;
        }
      }
    }
    
    // Reward detection
    const rewardPatterns = [
      /(Break Free[^,\n\r<]{0,50})/gi,
      /(\d+\s*Golden Keys?)/gi,
      /(Golden Key)/gi,
    ];
    
    let reward = "1x Golden Key";
    for (const pattern of rewardPatterns) {
      pattern.lastIndex = 0;
      const match = window.match(pattern);
      if (match) {
        reward = match[0].trim();
        break;
      }
    }
    
    return { reward, expires: parseStandardDate(bestDate), raw: `${bestDate || 'No date found'}`, hasValidDate: foundValidDate };
  }
};

function parseGamesRadarDate(dateStr) {
  if (!dateStr) return null;
  const currentYear = new Date().getFullYear();
  const cleanDate = dateStr.replace(/\./, '').trim();
  try {
    const parsed = new Date(`${cleanDate}, ${currentYear}`);
    if (!isNaN(parsed.getTime())) {
      parsed.setHours(23, 59, 59, 999);
      return parsed.toISOString();
    }
  } catch (e) {}
  return null;
}

function parseStandardDate(dateStr) {
  if (!dateStr) return null;
  
  // Handle permanent indicators
  if (/NEW|Unlisted|Permanent/i.test(dateStr)) {
    return null; // No expiration
  }
  
  // Handle long-term codes
  if (/Dec 31, 2030|December 31, 2030/i.test(dateStr)) {
    return "2030-12-31T23:59:59.999Z";
  }
  
  try {
    let cleanDate = dateStr.trim();
    cleanDate = cleanDate.replace(/Sept\b/gi, 'September');
    cleanDate = cleanDate.replace(/Oct\b/gi, 'October');
    cleanDate = cleanDate.replace(/Nov\b/gi, 'November');
    cleanDate = cleanDate.replace(/Dec\b/gi, 'December');
    
    const d = new Date(cleanDate);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2020 && d.getFullYear() < 2040) {
      d.setHours(23, 59, 59, 999);
      return d.toISOString();
    }
  } catch (e) {
    console.warn(`Failed to parse date: ${dateStr}`);
  }
  
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
  const pcGamerCodes = new Map();
  const otherSiteCodes = new Map();
  const finalEntries = new Map();
  
  // Step 1: Process PC Gamer (authoritative source)
  const pcGamerSource = SOURCES.find(s => s.name === "PC Gamer");
  if (pcGamerSource) {
    try {
      console.log(`Fetching from ${pcGamerSource.name} (AUTHORITATIVE SOURCE)...`);
      const html = await fetchText(pcGamerSource.url);
      const codes = html.match(codeRegex) || [];
      
      console.log(`Found ${codes.length} codes from ${pcGamerSource.name}`);
      
      for (const code of codes) {
        // Handle special hardcoded codes (they bypass normal rules)
        if (SPECIAL_CODES[code]) {
          const special = SPECIAL_CODES[code];
          pcGamerCodes.set(code, {
            code,
            reward: special.reward,
            expires: special.expires,
            source: special.source,
            sites: ["PC Gamer (Special)"]
          });
          console.log(`  ${code}: ${special.reward} (SPECIAL - BYPASSES RULES)`);
        } else {
          const extractor = siteExtractors[pcGamerSource.type] || siteExtractors.table;
          const result = extractor(html, code);
          
          // STRICT: PC Gamer codes need valid dates OR be permanent
          if (!result.expires && !result.hasValidDate && !isKnownPermanent(code)) {
            console.log(`  ${code}: REJECTED - No valid expiration date found on PC Gamer`);
            continue;
          }
          
          // Check if code is expired
          if (result.expires && isCodeExpired(result.expires)) {
            console.log(`  ${code}: EXPIRED (${new Date(result.expires).toLocaleDateString()}) - SKIPPING`);
            continue;
          }
          
          pcGamerCodes.set(code, {
            code,
            reward: result.reward,
            expires: result.expires,
            source: pcGamerSource.url,
            sites: ["PC Gamer"]
          });
          
          console.log(`  ${code}: ${result.reward} (expires: ${result.expires ? new Date(result.expires).toLocaleDateString() : 'Never'})`);
        }
      }
    } catch (err) {
      console.warn("PC Gamer failed:", String(err));
    }
  }
  
  // Step 2: Process other sources - MUCH STRICTER
  const otherSources = SOURCES.filter(s => s.name !== "PC Gamer");
  
  for (const src of otherSources) {
    try {
      console.log(`Fetching from ${src.name} for validation...`);
      const html = await fetchText(src.url);
      const codes = html.match(codeRegex) || [];
      
      console.log(`Found ${codes.length} codes from ${src.name}`);
      
      for (const code of codes) {
        // SKIP if PC Gamer already processed this code (PC Gamer is truth)
        if (pcGamerCodes.has(code)) {
          console.log(`  ${code}: SKIPPED - PC Gamer already handled this code`);
          continue;
        }
        
        // Extract code data
        let codeData;
        if (SPECIAL_CODES[code]) {
          const special = SPECIAL_CODES[code];
          codeData = {
            code,
            reward: special.reward,
            expires: special.expires,
            source: special.source,
            sites: [src.name],
            count: 1,
            hasValidDate: true
          };
        } else {
          const extractor = siteExtractors[src.type] || siteExtractors.table;
          const result = extractor(html, code);
          
          // STRICT RULE: Must have valid expiration date
          if (!result.expires && !result.hasValidDate && !isKnownPermanent(code)) {
            console.log(`  ${code}: REJECTED from ${src.name} - No valid expiration date`);
            continue;
          }
          
          // Check if code is expired
          if (result.expires && isCodeExpired(result.expires)) {
            console.log(`  ${code}: EXPIRED (${new Date(result.expires).toLocaleDateString()}) from ${src.name} - REJECTING`);
            continue;
          }
          
          codeData = {
            code,
            reward: result.reward,
            expires: result.expires,
            source: src.url,
            sites: [src.name],
            count: 1,
            hasValidDate: result.hasValidDate
          };
        }
        
        // Track codes from other sites
        if (!otherSiteCodes.has(code)) {
          otherSiteCodes.set(code, codeData);
        } else {
          const existing = otherSiteCodes.get(code);
          existing.count++;
          existing.sites.push(src.name);
        }
      }
    } catch (err) {
      console.warn(`${src.name} failed:`, String(err));
    }
  }
  
  // Step 3: Final validation - PC Gamer codes + strictly validated others
  
  // Add all PC Gamer codes (authoritative)
  for (const [code, data] of pcGamerCodes) {
    finalEntries.set(code, data);
  }
  
  // Add other codes ONLY if 2+ sites AND not conflicting with PC Gamer decisions
  for (const [code, data] of otherSiteCodes) {
    if (data.count >= 2) {
      finalEntries.set(code, data);
      console.log(`  ${code}: VALIDATED by ${data.count} sites (${data.sites.join(', ')}) - expires: ${data.expires ? new Date(data.expires).toLocaleDateString() : 'Never'}`);
    } else {
      console.log(`  ${code}: REJECTED - only found on 1 site (${data.sites[0]})`);
    }
  }

  console.log(`\nFinal Results:`);
  console.log(`- PC Gamer active codes: ${pcGamerCodes.size}`);
  console.log(`- Validated other active codes: ${finalEntries.size - pcGamerCodes.size}`);
  console.log(`- Total active codes: ${finalEntries.size}`);

  const payload = {
    updated: new Date().toISOString(),
    codes: Array.from(finalEntries.values())
      .sort((a, b) => {
        const ax = a.expires ? new Date(a.expires).getTime() : Infinity;
        const bx = b.expires ? new Date(b.expires).getTime() : Infinity;
        return ax - bx;
      })
  };

  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile("docs/codes.json", JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Wrote docs/codes.json with ${payload.codes.length} active codes only`);
}

function isKnownPermanent(code) {
  // Known permanent codes that don't expire
  const permanentCodes = [
    "T9RJB-BFKRR-3RBTW-B33TB-KCZB9",
    "39FB3-SHWXS-RRWZK-533TB-JHJBC"
  ];
  return permanentCodes.includes(code);
}

main().catch(e => { console.error(e); process.exit(1); });
