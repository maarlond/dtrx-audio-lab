"use strict";

/*
 * Suno release preflight — dependency free.
 *
 * The Suno MCP is available to agents, not ordinary Node.js processes. An
 * agent exports the exact Official Releases response into data/suno-official-
 * releases.json; this command only validates and previews that manifest.
 *
 * Run: npm.cmd run suno:sync
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const defaultManifest = path.join(
  projectRoot,
  "data",
  "suno-official-releases.json",
);
const defaultCatalog = path.join(projectRoot, "scripts", "catalog.js");
const defaultGeneratedCatalog = path.join(
  projectRoot,
  "scripts",
  "catalog.generated.js",
);
const defaultReport = path.join(
  projectRoot,
  "reports",
  "suno-sync-report.json",
);
const defaultStaging = path.join(
  projectRoot,
  "data",
  "suno-release-staging.json",
);

const normalizeTitle = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function parseArgs(argv) {
  const options = {
    manifest: defaultManifest,
    catalog: defaultCatalog,
    report: defaultReport,
    staging: defaultStaging,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--manifest")
      options.manifest = path.resolve(projectRoot, argv[++index] || "");
    else if (value === "--catalog")
      options.catalog = path.resolve(projectRoot, argv[++index] || "");
    else if (value === "--report")
      options.report = path.resolve(projectRoot, argv[++index] || "");
    else if (value === "--stage") options.stage = true;
    else if (value === "--staging")
      options.staging = path.resolve(projectRoot, argv[++index] || "");
    else if (value === "--apply") options.apply = true;
    else if (value === "--json") options.json = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  return options;
}

function slugify(value) {
  return (
    normalizeTitle(value)
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "") || "suno-release"
  );
}

function findStagedAssets(
  localId,
  musicRoot = path.join(projectRoot, "public", "music"),
) {
  const folder = path.join(musicRoot, localId);
  if (!fs.existsSync(folder))
    return { audio: false, cover: false, audioUrl: "", coverUrl: "" };
  const files = fs.readdirSync(folder);
  const audio = files.find((file) => /\.mp3$/i.test(file)) || "";
  const cover = files.find((file) => /\.(webp|png|jpe?g)$/i.test(file)) || "";
  const url = (file) =>
    `./public/music/${encodeURIComponent(localId)}/${encodeURIComponent(file)}`;
  return {
    audio: Boolean(audio),
    cover: Boolean(cover),
    audioUrl: audio ? url(audio) : "",
    coverUrl: cover ? url(cover) : "",
  };
}

function proposeLocalId(track, usedIds) {
  const base = slugify(track.title);
  const suffix = track.sunoId
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toLowerCase();
  let proposal = base;
  if (usedIds.has(proposal)) proposal = `${base}-${suffix}`;
  let index = 2;
  while (usedIds.has(proposal)) proposal = `${base}-${suffix}-${index++}`;
  usedIds.add(proposal);
  return proposal;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runCatalogFile(file, context) {
  const source = fs.readFileSync(file, "utf8");
  vm.runInNewContext(source, context, { filename: file });
}

function readCatalog(file, generatedFile = defaultGeneratedCatalog) {
  const context = { window: {} };
  runCatalogFile(file, context);
  if (generatedFile && fs.existsSync(generatedFile))
    runCatalogFile(generatedFile, context);
  const catalog = context.window.DTRX_CATALOG;
  if (!Array.isArray(catalog))
    throw new Error("catalog.js must assign an array to window.DTRX_CATALOG.");
  return catalog;
}

function validateManifest(manifest) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.tracks)
  ) {
    throw new Error("Manifest must contain a tracks array.");
  }
  const ids = new Set();
  for (const track of manifest.tracks) {
    if (!track || typeof track !== "object" || !track.sunoId || !track.title) {
      throw new Error("Every manifest track needs sunoId and title.");
    }
    if (ids.has(track.sunoId))
      throw new Error(`Duplicate Suno ID in manifest: ${track.sunoId}`);
    ids.add(track.sunoId);
  }
}

function findLocalAssets(track, local) {
  const source = local || {};
  return {
    audio: Boolean(source.audioUrl),
    cover: Boolean(source.coverUrl),
    audioUrl: source.audioUrl || "",
    coverUrl: source.coverUrl || "",
  };
}

function createPreview(manifest, catalog) {
  validateManifest(manifest);
  const bySunoId = new Map();
  const byTitle = new Map();
  for (const track of catalog) {
    if (track.sunoId)
      (
        bySunoId.get(track.sunoId) ||
        bySunoId.set(track.sunoId, []).get(track.sunoId)
      ).push(track);
    const title = normalizeTitle(track.title);
    (byTitle.get(title) || byTitle.set(title, []).get(title)).push(track);
  }
  const tracks = manifest.tracks.map((track) => {
    const exactMatches = bySunoId.get(track.sunoId) || [];
    const titleMatches = byTitle.get(normalizeTitle(track.title)) || [];
    const exact = exactMatches.length === 1 ? exactMatches[0] : null;
    const titleMatch = titleMatches.length === 1 ? titleMatches[0] : null;
    const local = exact || titleMatch;
    const assets = findLocalAssets(track, local);
    return {
      sunoId: track.sunoId,
      title: track.title,
      action:
        exactMatches.length > 1 || titleMatches.length > 1
          ? "ambiguous-match"
          : exact
            ? "update-linked-record"
            : local
              ? "link-existing-title-match"
              : "new-record",
      localId: local?.id || null,
      matchingLocalIds: [
        ...new Set([...exactMatches, ...titleMatches].map((match) => match.id)),
      ],
      titleChanged: Boolean(exact && exact.title !== track.title),
      metadataChanged: Boolean(
        exact &&
        (exact.duration !== track.duration || exact.style !== track.style),
      ),
      hasLocalAudio: assets.audio,
      hasLocalCover: assets.cover,
      hasSunoCover: Boolean(track.coverUrl),
      hasPlayableSource: assets.audio,
      songUrl: track.songUrl || "",
      visibility: track.visibility || "",
      duration: Number.isFinite(track.duration) ? track.duration : null,
      style: track.style || "",
    };
  });
  return {
    playlist: manifest.playlist || null,
    sourceCount: tracks.length,
    newRecords: tracks.filter((track) => track.action === "new-record").length,
    linkedByTitle: tracks.filter(
      (track) => track.action === "link-existing-title-match",
    ).length,
    linkedBySunoId: tracks.filter(
      (track) => track.action === "update-linked-record",
    ).length,
    ambiguous: tracks
      .filter((track) => track.action === "ambiguous-match")
      .map((track) => track.sunoId),
    removedFromPlaylist: catalog
      .filter(
        (track) =>
          track.sunoId &&
          !manifest.tracks.some((source) => source.sunoId === track.sunoId),
      )
      .map((track) => ({ localId: track.id, sunoId: track.sunoId })),
    missingAudio: tracks
      .filter((track) => !track.hasLocalAudio)
      .map((track) => track.sunoId),
    missingCover: tracks
      .filter((track) => !track.hasLocalCover && !track.hasSunoCover)
      .map((track) => track.sunoId),
    unplayable: tracks
      .filter((track) => !track.hasPlayableSource)
      .map((track) => track.sunoId),
    tracks,
  };
}

function createStagingPlan(manifest, catalog, musicRoot) {
  const preview = createPreview(manifest, catalog);
  const usedIds = new Set(catalog.map((track) => track.id));
  const proposals = preview.tracks
    .filter((track) => track.action === "new-record")
    .map((track) => {
      const localId = proposeLocalId(track, usedIds);
      const assets = findStagedAssets(localId, musicRoot);
      const pending = [];
      if (!assets.audio) pending.push("local-audio-required");
      if (!assets.cover) pending.push("local-cover-optional");
      if (!track.style) pending.push("style-metadata-missing");
      return {
        sunoId: track.sunoId,
        title: track.title,
        proposedLocalId: localId,
        duration: track.duration,
        style: track.style,
        visibility: track.visibility,
        songUrl: track.songUrl,
        sunoCoverUrl: track.hasSunoCover
          ? manifest.tracks.find((source) => source.sunoId === track.sunoId)
              .coverUrl
          : "",
        localAssets: assets,
        pending,
        readyForCatalog: false,
      };
    });
  return {
    generatedAt: new Date().toISOString(),
    mode: "staging",
    playlist: preview.playlist,
    proposals,
    removedFromPlaylist: preview.removedFromPlaylist,
    notes: [
      "No catalog, audio, cover, or deployment file is changed by staging.",
      "A separate approved import step is required before any proposal can reach the public catalog.",
    ],
  };
}

function writeStaging(plan, stagingPath, reportPath) {
  fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
  fs.writeFileSync(stagingPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify({ ...plan, stagingPath: path.relative(projectRoot, stagingPath).replaceAll("\\", "/") }, null, 2)}\n`,
    "utf8",
  );
  return plan;
}

function createApplicationPlan(manifest, catalog) {
  const preview = createPreview(manifest, catalog);
  const errors = [];
  const links = [];
  const linkedIds = new Set();
  for (const track of preview.tracks) {
    if (track.action === "ambiguous-match") {
      errors.push(
        `${track.sunoId} matches multiple local records: ${track.matchingLocalIds.join(", ")}`,
      );
      continue;
    }
    if (track.action === "new-record") {
      errors.push(
        `${track.sunoId} has no local catalog match; preview only, no record will be created.`,
      );
      continue;
    }
    if (track.action === "update-linked-record") continue;
    if (linkedIds.has(track.localId)) {
      errors.push(
        `Multiple Suno IDs would link to local record ${track.localId}.`,
      );
      continue;
    }
    linkedIds.add(track.localId);
    links.push({
      localId: track.localId,
      sunoId: track.sunoId,
      title: track.title,
    });
  }
  if (errors.length)
    throw new Error(`Application blocked:\n- ${errors.join("\n- ")}`);
  return { preview, links };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateCatalogSource(source, links) {
  let updated = source;
  const changes = [];
  for (const link of links) {
    const idPattern = new RegExp(
      `(\\{\\s*id:\\s*['\"]${escapeRegExp(link.localId)}['\"])(\\s*,)`,
      "g",
    );
    const matches = [...updated.matchAll(idPattern)];
    if (matches.length !== 1)
      throw new Error(
        `Could not safely locate one catalog record for ${link.localId}.`,
      );
    const recordStart = matches[0].index;
    const recordEnd = updated.indexOf("}", recordStart);
    if (recordEnd < 0)
      throw new Error(
        `Could not safely locate the end of catalog record ${link.localId}.`,
      );
    const record = updated.slice(recordStart, recordEnd + 1);
    const existingId = record.match(/\bsunoId:\s*['"]([^'"]+)['"]/);
    if (existingId && existingId[1] !== link.sunoId)
      throw new Error(
        `Catalog record ${link.localId} already links to a different Suno ID.`,
      );
    if (existingId) continue;
    updated = `${updated.slice(0, recordStart)}${record.replace(idPattern, `$1, sunoId: '${link.sunoId}',`)}${updated.slice(recordEnd + 1)}`;
    changes.push({ type: "linked-suno-id", ...link });
  }
  return { source: updated, changes };
}

function applyLinks({ manifest, catalog, catalogPath, reportPath }) {
  const plan = createApplicationPlan(manifest, catalog);
  const source = fs.readFileSync(catalogPath, "utf8");
  const result = updateCatalogSource(source, plan.links);
  if (result.changes.length)
    fs.writeFileSync(catalogPath, result.source, "utf8");
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "apply",
    playlist: plan.preview.playlist,
    sourceCount: plan.preview.sourceCount,
    changes: result.changes,
    unchangedLinkedRecords: plan.preview.tracks
      .filter((track) => track.action === "update-linked-record")
      .map((track) => ({ localId: track.localId, sunoId: track.sunoId })),
    catalogPath: path.relative(projectRoot, catalogPath).replaceAll("\\", "/"),
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function printPreview(preview) {
  console.log(
    `Suno playlist: ${preview.playlist?.name || "Unknown"} (${preview.sourceCount} track(s))`,
  );
  console.log(
    `New: ${preview.newRecords} | linked by Suno ID: ${preview.linkedBySunoId} | title matches needing approval: ${preview.linkedByTitle}`,
  );
  for (const track of preview.tracks) {
    console.log(
      `- ${track.title} [${track.sunoId}] → ${track.action}; local audio: ${track.hasLocalAudio ? "yes" : "no"}; local cover: ${track.hasLocalCover ? "yes" : "no"}; Suno cover: ${track.hasSunoCover ? "yes" : "no"}`,
    );
  }
  if (!preview.sourceCount)
    console.log("Playlist is empty. No catalog changes are proposed.");
  if (preview.unplayable.length)
    console.log(
      `Not publishable without an approved playable source: ${preview.unplayable.join(", ")}`,
    );
  console.log(
    "Preview only: no catalog, media, or deployment file was changed.",
  );
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const manifest = readJson(options.manifest);
    const catalog = readCatalog(options.catalog);
    if (options.apply && options.stage)
      throw new Error("--apply and --stage cannot be used together.");
    if (options.apply) {
      const report = applyLinks({
        manifest,
        catalog,
        catalogPath: options.catalog,
        reportPath: options.report,
      });
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else
        console.log(
          `Applied ${report.changes.length} link(s). Report: ${path.relative(projectRoot, options.report)}`,
        );
    } else if (options.stage) {
      const plan = writeStaging(
        createStagingPlan(manifest, catalog),
        options.staging,
        options.report,
      );
      if (options.json) console.log(JSON.stringify(plan, null, 2));
      else
        console.log(
          `Staged ${plan.proposals.length} new record proposal(s). No catalog entries were added.`,
        );
    } else {
      const preview = createPreview(manifest, catalog);
      if (options.json) console.log(JSON.stringify(preview, null, 2));
      else printPreview(preview);
    }
  } catch (error) {
    console.error(`Suno sync preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  applyLinks,
  createApplicationPlan,
  createPreview,
  createStagingPlan,
  findStagedAssets,
  normalizeTitle,
  proposeLocalId,
  readCatalog,
  updateCatalogSource,
  validateManifest,
};
