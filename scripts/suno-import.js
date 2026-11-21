"use strict";

/*
 * Approved Suno release importer. It is deliberately local-only: the Suno MCP
 * exports the manifest, while this script receives already-approved media.
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeTitle,
  readCatalog,
  validateManifest,
} = require("./suno-sync.js");
const { generateCatalog } = require("./import-local-music.js");

const projectRoot = path.resolve(__dirname, "..");
const defaults = {
  manifest: path.join(projectRoot, "data", "suno-official-releases.json"),
  catalog: path.join(projectRoot, "scripts", "catalog.js"),
  imports: path.join(projectRoot, "imports", "suno"),
  music: path.join(projectRoot, "public", "music"),
  generated: path.join(projectRoot, "scripts", "catalog.generated.js"),
  report: path.join(projectRoot, "reports", "suno-import-report.json"),
};
const safeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseArgs(argv) {
  const options = { ...defaults, confirm: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (
      arg === "--manifest" ||
      arg === "--catalog" ||
      arg === "--imports" ||
      arg === "--music" ||
      arg === "--generated" ||
      arg === "--report"
    ) {
      const key = arg.slice(2);
      options[key] = path.resolve(projectRoot, argv[++i] || "");
    } else if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm") options.confirm.push(argv[++i] || "");
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function readJson(file, label = "JSON") {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${file}: ${error.message}`);
  }
}

function slugify(value) {
  return (
    normalizeTitle(value)
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "") || "suno-release"
  );
}

function proposedSlug(track, used) {
  const base = slugify(track.title);
  const suffix = track.sunoId
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toLowerCase();
  let slug = base;
  if (used.has(slug)) slug = `${base}-${suffix}`;
  let index = 2;
  while (used.has(slug)) slug = `${base}-${suffix}-${index++}`;
  return slug;
}

function isMp3(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 4) return false;
  const bytes = fs.readFileSync(file).subarray(0, 3);
  return (
    bytes.toString("ascii") === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  );
}

function isCover(file) {
  if (!file || !fs.existsSync(file) || fs.statSync(file).size < 3) return false;
  const bytes = fs.readFileSync(file).subarray(0, 12);
  const extension = path.extname(file).toLowerCase();
  if (extension === ".webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function inspectImportFolder(folder) {
  const audio = path.join(folder, "audio.mp3");
  const cover =
    ["cover.webp", "cover.jpg", "cover.jpeg"]
      .map((name) => path.join(folder, name))
      .find(fs.existsSync) || "";
  const lyrics = path.join(folder, "lyrics.lrc");
  const metadataFile = path.join(folder, "metadata.json");
  let metadata = {};
  let metadataError = "";
  if (fs.existsSync(metadataFile)) {
    try {
      metadata = readJson(metadataFile, "metadata.json");
      if (!metadata || Array.isArray(metadata) || typeof metadata !== "object")
        throw new Error("must be a JSON object");
    } catch (error) {
      metadataError = error.message;
    }
  }
  return {
    folder,
    audio: fs.existsSync(audio) ? audio : "",
    validAudio: isMp3(audio),
    cover,
    validCover: !cover || isCover(cover),
    lyrics: fs.existsSync(lyrics) ? lyrics : "",
    metadata,
    metadataError,
  };
}

function catalogEntry(track, slug, metadata) {
  const pick = (key) =>
    typeof metadata[key] === "string" ? metadata[key].trim() : "";
  const title = pick("title") || track.title;
  return {
    id: slug,
    sunoId: track.sunoId,
    title,
    artist: pick("artist"),
    genre: pick("genre"),
    audioUrl: "",
    coverUrl: "",
    lyricsUrl: "",
    featured: false,
  };
}

function listImportIds(importRoot) {
  if (!fs.existsSync(importRoot)) return [];
  return fs
    .readdirSync(importRoot, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name);
}

function createImportPlan({ manifest, catalog, importsRoot, musicRoot }) {
  validateManifest(manifest);
  const manifestById = new Map(
    manifest.tracks.map((track) => [track.sunoId, track]),
  );
  const catalogBySuno = new Map();
  for (const record of catalog) {
    if (!record.sunoId) continue;
    const records = catalogBySuno.get(record.sunoId) || [];
    records.push(record);
    catalogBySuno.set(record.sunoId, records);
  }
  const usedSlugs = new Set(catalog.map((record) => record.id));
  const folderIds = listImportIds(importsRoot);
  const proposals = [];
  const ignored = [];
  for (const sunoId of folderIds) {
    const track = manifestById.get(sunoId);
    if (!track) {
      ignored.push({ sunoId, reason: "not-in-official-releases" });
      continue;
    }
    const duplicates = catalogBySuno.get(sunoId) || [];
    if (duplicates.length) {
      proposals.push({
        sunoId,
        title: track.title,
        status: duplicates.length === 1 ? "already-imported" : "blocked",
        localIds: duplicates.map((item) => item.id),
        reasons:
          duplicates.length === 1
            ? ["catalog-already-has-suno-id"]
            : ["duplicate-suno-id-in-catalog"],
      });
      continue;
    }
    const assets = inspectImportFolder(path.join(importsRoot, sunoId));
    const slug = proposedSlug(track, usedSlugs);
    const destination = path.join(musicRoot, slug);
    const reasons = [];
    if (!assets.audio) reasons.push("audio.mp3-required");
    else if (!assets.validAudio)
      reasons.push("audio.mp3-is-not-a-valid-mp3-header");
    if (assets.cover && !assets.validCover)
      reasons.push("cover-is-not-a-valid-image-header");
    if (assets.metadataError) reasons.push("metadata.json-invalid");
    if (fs.existsSync(destination))
      reasons.push("destination-folder-already-exists");
    if (!safeId.test(slug)) reasons.push("invalid-proposed-slug");
    const record = catalogEntry(track, slug, assets.metadata);
    proposals.push({
      sunoId,
      title: track.title,
      status: reasons.length ? "blocked" : "ready-for-approval",
      reasons,
      slug,
      destination: path
        .relative(projectRoot, destination)
        .replaceAll("\\", "/"),
      files: {
        audio: Boolean(assets.audio),
        cover: path.basename(assets.cover || ""),
        lyrics: Boolean(assets.lyrics),
        metadata: Boolean(Object.keys(assets.metadata).length),
      },
      record,
    });
    usedSlugs.add(slug);
  }
  return {
    generatedAt: new Date().toISOString(),
    playlist: manifest.playlist || null,
    proposals,
    ignored,
    notes: [
      "Preview never changes the catalog or media.",
      "A Suno page URL is never used as an audio source.",
      "Only explicit --confirm IDs can be applied.",
    ],
  };
}

function serializeEntry(entry) {
  const quote = (value) =>
    `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  return `  { id: ${quote(entry.id)}, sunoId: ${quote(entry.sunoId)}, title: ${quote(entry.title)}, artist: ${quote(entry.artist)}, genre: ${quote(entry.genre)}, audioUrl: '', coverUrl: '', lyricsUrl: '', featured: false }`;
}

function appendCatalogEntries(source, entries) {
  if (!entries.length) return source;
  const marker = /\];\s*$/;
  if (!marker.test(source))
    throw new Error(
      "catalog.js does not have the expected DTRX_CATALOG array ending.",
    );
  const separator = source.match(/\[\s*\]/) ? "" : ",";
  return source.replace(
    marker,
    `${separator}\n${entries.map(serializeEntry).join(",\n")}\n];\n`,
  );
}

function applyImportPlan({ plan, options }) {
  if (!options.confirm.length)
    throw new Error(
      "Application requires at least one explicit --confirm <sunoId>.",
    );
  const requested = new Set(options.confirm);
  if (requested.size !== options.confirm.length)
    throw new Error("Each confirmed Suno ID must be listed only once.");
  const ready = new Map(
    plan.proposals
      .filter((item) => item.status === "ready-for-approval")
      .map((item) => [item.sunoId, item]),
  );
  const missing = [...requested].filter((id) => !ready.has(id));
  if (missing.length)
    throw new Error(
      `Confirmed IDs are not ready for import: ${missing.join(", ")}`,
    );
  const selected = [...requested].map((id) => ready.get(id));
  const source = fs.readFileSync(options.catalog, "utf8");
  const nextCatalog = appendCatalogEntries(
    source,
    selected.map((item) => item.record),
  );
  // Validate every destination before the first copy or catalog write.
  for (const item of selected) {
    const destination = path.join(options.music, item.slug);
    if (fs.existsSync(destination))
      throw new Error(
        `Refusing to overwrite existing destination: ${destination}`,
      );
  }
  for (const item of selected) {
    const sourceFolder = path.join(options.imports, item.sunoId);
    const destination = path.join(options.music, item.slug);
    fs.mkdirSync(destination, { recursive: false });
    for (const file of [
      "audio.mp3",
      "cover.webp",
      "cover.jpg",
      "cover.jpeg",
      "lyrics.lrc",
      "metadata.json",
    ]) {
      const from = path.join(sourceFolder, file);
      if (fs.existsSync(from))
        fs.copyFileSync(from, path.join(destination, file));
    }
  }
  fs.writeFileSync(options.catalog, nextCatalog, "utf8");
  // Refresh the derived asset manifest so the newly copied local MP3 is usable
  // on the next page load. It does not fetch, replace, or delete any media.
  generateCatalog(options.music, options.generated);
  return {
    generatedAt: new Date().toISOString(),
    mode: "apply",
    playlist: plan.playlist,
    imported: selected.map((item) => ({
      sunoId: item.sunoId,
      localId: item.slug,
      destination: item.destination,
    })),
    unchanged: plan.proposals
      .filter((item) => item.status === "already-imported")
      .map((item) => ({ sunoId: item.sunoId, localIds: item.localIds })),
  };
}

function printPlan(plan) {
  console.log(`Suno playlist: ${plan.playlist?.name || "Unknown"}`);
  if (!plan.proposals.length)
    console.log("No local import folders found. Nothing is proposed.");
  for (const item of plan.proposals)
    console.log(
      `- ${item.title} [${item.sunoId}] → ${item.status}${item.slug ? ` (${item.slug})` : ""}${item.reasons?.length ? `: ${item.reasons.join(", ")}` : ""}`,
    );
  for (const item of plan.ignored)
    console.log(`- ${item.sunoId} → blocked: ${item.reason}`);
  console.log("Preview only: no catalog or media was changed.");
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const manifest = readJson(options.manifest, "Official Releases manifest");
    const catalog = readCatalog(options.catalog);
    const plan = createImportPlan({
      manifest,
      catalog,
      importsRoot: options.imports,
      musicRoot: options.music,
    });
    if (!options.apply) {
      if (options.json) console.log(JSON.stringify(plan, null, 2));
      else printPlan(plan);
    } else {
      const report = applyImportPlan({ plan, options });
      fs.mkdirSync(path.dirname(options.report), { recursive: true });
      fs.writeFileSync(
        options.report,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else
        console.log(
          `Imported ${report.imported.length} approved release(s). Report: ${path.relative(projectRoot, options.report)}`,
        );
    }
  } catch (error) {
    console.error(`Suno import failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  appendCatalogEntries,
  createImportPlan,
  applyImportPlan,
  inspectImportFolder,
  isCover,
  isMp3,
  proposedSlug,
  slugify,
};
