/**
 * Compact game data for production builds.
 *
 * Reads from the full Raidbots data directory and outputs a stripped version
 * containing only the files and fields that simhammer-core actually uses.
 *
 * Usage:  node compact-data.js <input-dir> <output-dir>
 *
 * ── MANIFEST ──────────────────────────────────────────────────────────
 * When game_data.rs starts using new files or fields, update this manifest.
 * Everything not listed here is stripped from the build output.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ---------------------------------------------------------------------------
// Manifest: which files to include and which fields to keep per file.
//   null = copy the whole file as-is (minified)
//   [...] = keep only these top-level fields per array element / object value
// ---------------------------------------------------------------------------
const MANIFEST = {
  // Items — only keep fields accessed by game_data.rs.
  // Also filter out items without sources (not droppable = not needed).
  "equippable-items-full.json": {
    // Handled specially — see compactItems()
    custom: true,
  },

  // Enchantments — minify only. Field-stripping saved ~50 KB and was a silent-
  // failure footgun whenever the Rust runtime started reading a new field.
  "enchantments.json": null,

  // Bonuses — minify only (see enchantments.json note). The `item_limit_category`
  // field is load-bearing for embellishment validation; stripping it once silently
  // disabled the max-2 embellishments rule across web and desktop releases.
  "bonuses.json": null,

  // Upgrade track data — small file, keep as-is
  "bonus-upgrade-sets.json": null,

  // Seasons — small file, keep as-is
  "seasons.json": null,

  // Instances — enriched with Blizzard CDN image URLs at compaction time
  "instances.json": { custom: true, handler: "instances" },

  // Season config — our own file, keep as-is
  "season-config.json": null,

  // Talent trees — keep as-is (keyed by specId)
  "talents.json": null,

  // Catalyst item conversions — keep as-is
  "item-conversions.json": null,

  // Item limit categories (e.g. max 2 embellished) — keep as-is
  "item-limit-categories.json": null,

  // Item squish era mapping — keep as-is
  "item-squish-era.json": null,

  // Item curves for ilevel conversion — keep as-is
  "item-curves.json": null,

  // Encounter items — minify only (see enchantments.json note).
  "encounter-items.json": null,

  // Localized item names — strip to only equippable item IDs
  "item-names.json": { custom: true, handler: "itemNames" },

  // Consumable data files — keep as-is (small files)
  "flasks.json": null,
  "potions.json": null,
  "foods.json": null,
  "augments.json": null,
  "temp-enchants.json": null,

};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

// Fields needed for item lookups (get_item_info, armor filtering, catalyst, legacy items)
const ITEM_BASE_FIELDS = [
  "id", "name", "icon", "quality", "itemLevel",
  "itemClass", "itemSubClass", "inventoryType",
  "squishEra",        // legacy/timewalking ilevel conversion
  "itemSetId",        // catalyst tier set detection
  "allowableClasses", // catalyst class filtering
  "itemLimit",        // inherent embellishment / unique-category constraint
];

// Additional fields needed for droppable items (droptimizer, spec filtering)
const ITEM_DROP_FIELDS = [...ITEM_BASE_FIELDS, "sources", "specs"];

/**
 * Compact equippable-items-full.json:
 * - Current expansion items: keep all needed fields
 * - Older items with drop sources: keep drop fields (for timewalking etc.)
 * - Older items without sources: keep only base fields for item lookups
 */
function compactItems(inputPath, outputPath) {
  const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));

  // Detect current expansion as the highest expansion number
  let currentExp = 0;
  for (const i of data) if ((i.expansion || 0) > currentExp) currentExp = i.expansion;

  const result = data.map(item => {
    const hasSources = item.sources && item.sources.length > 0;
    const isCurrent = (item.expansion || 0) === currentExp;

    // Current expansion or has drop sources: keep drop-related fields
    if (isCurrent || hasSources) {
      const out = pickFields(item, ITEM_DROP_FIELDS);
      // Strip sources down to encounterId + instanceId
      if (out.sources) {
        out.sources = out.sources.map(s => ({ encounterId: s.encounterId, instanceId: s.instanceId }));
      }
      return out;
    }

    // Older items without sources: minimal fields for item lookups only
    return pickFields(item, ITEM_BASE_FIELDS);
  });

  fs.writeFileSync(outputPath, JSON.stringify(result));
}

/**
 * Download a URL to a local file. Returns true on success.
 */
function downloadFile(url, dest) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadFile(res.headers.location, dest).then(resolve);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        resolve(false);
        return;
      }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on("finish", () => { ws.close(); resolve(true); });
      ws.on("error", () => resolve(false));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(10000, () => { req.destroy(); resolve(false); });
  });
}

/**
 * Compact instances.json, download instance tile images, and rewrite URLs to local paths.
 */
async function compactInstances(inputPath, outputPath, inputDir, outputDir) {
  const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));

  // Load instance and encounter image URLs from Blizzard API data (fetched at build time)
  let imageMap = new Map(); // id -> remote_url (instances + encounters)

  // Primary: blizzard-instances.json (all expansion dungeons + raids)
  const instancesPath = path.join(inputDir, "blizzard-instances.json");
  if (fs.existsSync(instancesPath)) {
    try {
      const instances = JSON.parse(fs.readFileSync(instancesPath, "utf8"));
      for (const inst of [...(instances.dungeons || []), ...(instances.raids || [])]) {
        if (inst.id && inst.image_url) {
          imageMap.set(inst.id, inst.image_url);
        }
        // Encounter creature images
        for (const enc of inst.encounters || []) {
          if (enc.id && enc.image_url) {
            imageMap.set(enc.id, enc.image_url);
          }
        }
      }
    } catch { /* malformed file */ }
  }

  // Supplement: blizzard-season.json M+ rotation (covers old-expansion dungeons in rotation)
  const seasonPath = path.join(inputDir, "blizzard-season.json");
  if (fs.existsSync(seasonPath)) {
    try {
      const season = JSON.parse(fs.readFileSync(seasonPath, "utf8"));
      for (const d of season.mplus_rotation || []) {
        if (d.instance_id != null && d.image_url && !imageMap.has(d.instance_id)) {
          imageMap.set(d.instance_id, d.image_url);
        }
      }
    } catch { /* malformed file */ }
  }

  // Fallback: use any image_url already present in source instances.json
  // (covers synthetic entries like World Bosses that aren't in Blizzard journal data)
  for (const inst of data) {
    if (!imageMap.has(inst.id) && inst.image_url && inst.image_url.startsWith("http")) {
      imageMap.set(inst.id, inst.image_url);
    }
  }

  // Download images to output dir
  const imagesDir = path.join(outputDir, "instance-images");
  const localMap = new Map(); // instance_id -> local api path
  if (imageMap.size > 0) {
    fs.mkdirSync(imagesDir, { recursive: true });
    const results = await Promise.all(
      [...imageMap.entries()].map(async ([id, url]) => {
        const ext = path.extname(new URL(url).pathname) || ".jpg";
        const filename = `${id}${ext}`;
        const dest = path.join(imagesDir, filename);
        const ok = await downloadFile(url, dest);
        if (ok) {
          localMap.set(id, `/api/data/instance-images/${filename}`);
          return true;
        }
        return false;
      })
    );
    const downloaded = results.filter(Boolean).length;
    console.log(`    (downloaded ${downloaded}/${imageMap.size} instance images)`);
  }

  // Write local paths into instance data (and remove broken external URLs)
  for (const instance of data) {
    if (localMap.has(instance.id)) {
      instance.image_url = localMap.get(instance.id);
    } else if (instance.image_url && instance.image_url.startsWith("http")) {
      delete instance.image_url;
    }
    if (instance.encounters) {
      for (const enc of instance.encounters) {
        if (localMap.has(enc.id)) {
          enc.image_url = localMap.get(enc.id);
        } else if (enc.image_url && enc.image_url.startsWith("http")) {
          delete enc.image_url;
        }
      }
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(data));
}

/**
 * Compact item-names.json: strip to only item IDs present in equippable-items-full.json.
 * The full file is ~64MB; after filtering it's a fraction of that.
 */
function compactItemNames(inputPath, outputPath, inputDir) {
  const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const sparse = data.ItemSparse;
  if (!sparse) {
    fs.writeFileSync(outputPath, JSON.stringify(data));
    return;
  }

  // Only keep names for current expansion items (encounter drops + equippable)
  const itemsPath = path.join(inputDir, "equippable-items-full.json");
  const encounterItemsPath = path.join(inputDir, "encounter-items.json");
  const validIds = new Set();

  if (fs.existsSync(itemsPath)) {
    const items = JSON.parse(fs.readFileSync(itemsPath, "utf8"));
    let currentExp = 0;
    for (const i of items) if ((i.expansion || 0) > currentExp) currentExp = i.expansion;
    for (const item of items) {
      if (item.id && (item.expansion || 0) === currentExp) validIds.add(String(item.id));
    }
  }
  if (fs.existsSync(encounterItemsPath)) {
    const items = JSON.parse(fs.readFileSync(encounterItemsPath, "utf8"));
    let currentExp = 0;
    for (const i of items) if ((i.expansion || 0) > currentExp) currentExp = i.expansion;
    for (const item of items) {
      if (item.id && (item.expansion || 0) === currentExp) validIds.add(String(item.id));
    }
  }

  const filtered = {};
  for (const [id, locales] of Object.entries(sparse)) {
    if (validIds.has(id)) {
      filtered[id] = locales;
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify({ ItemSparse: filtered }));
  console.log(`    (kept ${Object.keys(filtered).length}/${Object.keys(sparse).length} item names)`);
}

function pickFields(obj, fields) {
  const result = {};
  for (const f of fields) {
    if (f in obj) result[f] = obj[f];
  }
  return result;
}

async function compactFile(inputPath, outputPath, config, inputDir, outputDir) {
  if (config && config.custom) {
    if (config.handler === "instances") {
      await compactInstances(inputPath, outputPath, inputDir, outputDir);
    } else if (config.handler === "itemNames") {
      compactItemNames(inputPath, outputPath, inputDir);
    } else {
      compactItems(inputPath, outputPath);
    }
    return;
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.warn(`  SKIP ${path.basename(inputPath)} (not valid JSON)`);
    return;
  }

  if (config === null) {
    // Just minify
    fs.writeFileSync(outputPath, JSON.stringify(data));
    return;
  }

  const { fields, filter, transform } = config;

  if (Array.isArray(data)) {
    // Array of objects (items, enchantments)
    let items = data;
    if (filter) items = items.filter(filter);
    if (fields) items = items.map(item => pickFields(item, fields));
    if (transform) items = items.map(transform);
    fs.writeFileSync(outputPath, JSON.stringify(items));
  } else if (typeof data === "object") {
    // Object keyed by ID (bonuses, bonus-upgrade-sets)
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      if (fields && typeof value === "object" && !Array.isArray(value)) {
        result[key] = pickFields(value, fields);
      } else {
        result[key] = value;
      }
    }
    fs.writeFileSync(outputPath, JSON.stringify(result));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: node compact-data.js <input-dir> <output-dir>");
    process.exit(1);
  }

  const [inputDir, outputDir] = args;

  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  let totalIn = 0;
  let totalOut = 0;

  // Process only JSON files listed in the MANIFEST.
  const manifestFiles = Object.keys(MANIFEST);

  for (const filename of manifestFiles) {
    const inputPath = path.join(inputDir, filename);
    if (!fs.existsSync(inputPath)) {
      console.warn(`  SKIP ${filename} (not found)`);
      continue;
    }
    const outputPath = path.join(outputDir, filename);
    const config = MANIFEST[filename];

    const inSize = fs.statSync(inputPath).size;
    await compactFile(inputPath, outputPath, config, inputDir, outputDir);
    const outSize = fs.statSync(outputPath).size;

    totalIn += inSize;
    totalOut += outSize;

    const pct = ((1 - outSize / inSize) * 100).toFixed(0);
    console.log(
      `  ${filename.padEnd(35)} ${fmt(inSize)} -> ${fmt(outSize)}  (-${pct}%)`
    );
  }

  console.log(
    `\n  Total: ${fmt(totalIn)} -> ${fmt(totalOut)}  (-${((1 - totalOut / totalIn) * 100).toFixed(0)}%)`
  );

  // Download static assets (faction crests + backgrounds)
  const staticAssets = {
    "faction-alliance.png": "https://assets-bwa.worldofwarcraft.blizzard.com/dab2428aa2f51e140c9a.png",
    "faction-horde.png": "https://assets-bwa.worldofwarcraft.blizzard.com/3edbc547ab318bd385b2.png",
    "faction-bg-alliance.jpg": "https://assets-bwa.worldofwarcraft.blizzard.com/ae30cbf7f81a72bba2fc.jpg",
    "faction-bg-horde.jpg": "https://assets-bwa.worldofwarcraft.blizzard.com/4ff3a76b171ba4f1842b.jpg",
  };
  const assetsDir = path.join(outputDir, "static");
  fs.mkdirSync(assetsDir, { recursive: true });
  let assetCount = 0;
  for (const [filename, url] of Object.entries(staticAssets)) {
    const dest = path.join(assetsDir, filename);
    if (await downloadFile(url, dest)) assetCount++;
  }
  if (assetCount > 0) {
    console.log(`  Downloaded ${assetCount} static assets`);
  }

  console.log(`  Output: ${outputDir}`);
}

function fmt(bytes) {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + "KB";
  return (bytes / 1024 / 1024).toFixed(1) + "MB";
}

main().catch((err) => { console.error(err); process.exit(1); });
