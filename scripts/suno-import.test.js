"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { applyImportPlan, createImportPlan } = require("./suno-import.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dtrx-suno-import-"));
const imports = path.join(root, "imports", "suno");
const music = path.join(root, "public", "music");
const catalog = path.join(root, "catalog.js");
const generated = path.join(root, "catalog.generated.js");
fs.mkdirSync(imports, { recursive: true });
fs.mkdirSync(music, { recursive: true });
fs.writeFileSync(
  catalog,
  "window.DTRX_CATALOG = [{ id: 'manual-release', title: 'Manual Release', artist: 'DTRX', genre: '', audioUrl: '', coverUrl: '', lyricsUrl: '', featured: true }];\n",
  "utf8",
);

const releaseId = "11111111-2222-3333-4444-555555555555";
const secondId = "66666666-7777-8888-9999-aaaaaaaaaaaa";
const manifest = {
  playlist: { id: "official", name: "DTRX | Official Releases" },
  tracks: [
    {
      sunoId: releaseId,
      title: "Approved Future Release",
      duration: 180,
      style: "House",
    },
    { sunoId: secondId, title: "Manual Release", duration: 200 },
  ],
};

function addFixture(id, files = {}) {
  const folder = path.join(imports, id);
  fs.mkdirSync(folder, { recursive: true });
  for (const [name, value] of Object.entries(files))
    fs.writeFileSync(path.join(folder, name), value);
  return folder;
}
function readTestCatalog() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(catalog, "utf8"), context);
  return context.window.DTRX_CATALOG;
}

addFixture(releaseId, {
  "audio.mp3": Buffer.from("ID3approved-test-audio"),
  "cover.webp": Buffer.from("RIFFxxxxWEBP"),
  "lyrics.lrc": "[00:00.00] approved lyrics",
  "metadata.json": JSON.stringify({ artist: "DTRX", genre: "Electronic" }),
});
addFixture(secondId, { "audio.mp3": Buffer.from("ID3second-test-audio") });
addFixture("not-official-id", { "audio.mp3": Buffer.from("ID3outside") });

let plan = createImportPlan({
  manifest,
  catalog: readTestCatalog(),
  importsRoot: imports,
  musicRoot: music,
});
const ready = plan.proposals.find((item) => item.sunoId === releaseId);
assert.equal(ready.status, "ready-for-approval");
assert.equal(ready.slug, "approved-future-release");
assert.equal(
  plan.proposals.find((item) => item.sunoId === secondId).slug,
  "manual-release-66666666",
  "a conflicting slug receives a stable Suno suffix",
);
assert.deepEqual(plan.ignored, [
  { sunoId: "not-official-id", reason: "not-in-official-releases" },
]);

assert.throws(
  () =>
    applyImportPlan({
      plan,
      options: { catalog, imports, music, generated, confirm: [] },
    }),
  /explicit --confirm/,
);
const beforeAudio = fs.readFileSync(path.join(imports, releaseId, "audio.mp3"));
const report = applyImportPlan({
  plan,
  options: { catalog, imports, music, generated, confirm: [releaseId] },
});
assert.equal(report.imported.length, 1);
assert.deepEqual(
  fs.readFileSync(path.join(imports, releaseId, "audio.mp3")),
  beforeAudio,
  "source import media is preserved",
);
assert.ok(
  fs.existsSync(path.join(music, "approved-future-release", "audio.mp3")),
);
assert.ok(
  fs.existsSync(path.join(music, "approved-future-release", "cover.webp")),
);
assert.ok(
  fs.existsSync(path.join(music, "approved-future-release", "lyrics.lrc")),
);
const linked = readTestCatalog().find((item) => item.sunoId === releaseId);
assert.equal(linked.id, "approved-future-release");
assert.equal(
  linked.audioUrl,
  "",
  "manual catalog keeps generated asset URLs separate",
);
assert.match(
  fs.readFileSync(generated, "utf8"),
  /approved-future-release/,
  "the derived catalog receives the copied local MP3",
);

plan = createImportPlan({
  manifest,
  catalog: readTestCatalog(),
  importsRoot: imports,
  musicRoot: music,
});
assert.equal(
  plan.proposals.find((item) => item.sunoId === releaseId).status,
  "already-imported",
  "second execution never duplicates a linked record",
);
assert.throws(
  () =>
    applyImportPlan({
      plan,
      options: { catalog, imports, music, generated, confirm: [releaseId] },
    }),
  /not ready/,
);

const missingId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const invalidId = "12121212-3434-5656-7878-909090909090";
const validationManifest = {
  playlist: manifest.playlist,
  tracks: [
    { sunoId: missingId, title: "Missing Audio" },
    { sunoId: invalidId, title: "Invalid Audio" },
  ],
};
addFixture(missingId, { "cover.jpg": Buffer.from([0xff, 0xd8, 0xff]) });
addFixture(invalidId, { "audio.mp3": Buffer.from("not-an-mp3") });
const validation = createImportPlan({
  manifest: validationManifest,
  catalog: readTestCatalog(),
  importsRoot: imports,
  musicRoot: music,
});
assert.deepEqual(
  validation.proposals.find((item) => item.sunoId === missingId).reasons,
  ["audio.mp3-required"],
);
assert.deepEqual(
  validation.proposals.find((item) => item.sunoId === invalidId).reasons,
  ["audio.mp3-is-not-a-valid-mp3-header"],
);
assert.equal(
  plan.proposals.find((item) => item.sunoId === secondId).files.cover,
  "",
  "a cover remains optional for an otherwise ready release",
);

const duplicate = createImportPlan({
  manifest: {
    playlist: manifest.playlist,
    tracks: [{ sunoId: releaseId, title: "Approved Future Release" }],
  },
  catalog: [
    ...readTestCatalog(),
    { id: "duplicate", sunoId: releaseId, title: "Duplicate" },
  ],
  importsRoot: imports,
  musicRoot: music,
});
assert.equal(duplicate.proposals[0].status, "blocked");
assert.deepEqual(duplicate.proposals[0].reasons, [
  "duplicate-suno-id-in-catalog",
]);

fs.rmSync(root, { recursive: true, force: true });
console.log("suno-import tests passed");
