"use strict";

const assert = require("node:assert/strict");
const {
  createApplicationPlan,
  createPreview,
  createStagingPlan,
  readCatalog,
  updateCatalogSource,
} = require("./suno-sync.js");

const catalog = [
  {
    id: "existing",
    title: "Fading Into You",
    audioUrl: "./audio.mp3",
    coverUrl: "./cover.jpeg",
    featured: true,
  },
];
const source = {
  playlist: { id: "playlist-1", name: "DTRX | Official Releases" },
  tracks: [
    {
      sunoId: "suno-1",
      title: "FADING INTO YOU",
      duration: 150,
      style: "Melodic trap",
      coverUrl: "https://cover.example/art.jpeg",
    },
  ],
};

const first = createPreview(source, catalog);
assert.equal(first.sourceCount, 1);
assert.equal(first.linkedByTitle, 1);
assert.equal(first.newRecords, 0);
assert.equal(first.tracks[0].hasLocalAudio, true);
assert.equal(first.tracks[0].hasLocalCover, true);
assert.equal(
  catalog[0].featured,
  true,
  "manual catalog fields must not be mutated by preview",
);

const repeated = createPreview(source, catalog);
assert.deepEqual(repeated, first, "repeated previews must be idempotent");

const empty = createPreview({ playlist: source.playlist, tracks: [] }, catalog);
assert.equal(empty.sourceCount, 0, "empty Official Releases must be valid");

const incomplete = createPreview(
  {
    playlist: source.playlist,
    tracks: [{ sunoId: "suno-2", title: "No Assets" }],
  },
  [],
);
assert.equal(incomplete.newRecords, 1);
assert.equal(
  incomplete.unplayable.length,
  1,
  "a Suno page URL is not an audio source",
);
assert.equal(
  incomplete.missingCover.length,
  1,
  "a missing local and Suno cover is reported",
);

const linked = createPreview(
  {
    playlist: source.playlist,
    tracks: [
      {
        sunoId: "suno-1",
        title: "Renamed Song",
        duration: 180,
        style: "House",
      },
    ],
  },
  [
    {
      id: "stable",
      sunoId: "suno-1",
      title: "Old Title",
      duration: 100,
      style: "Other",
      audioUrl: "./local.mp3",
      coverUrl: "./local.jpeg",
      featured: true,
    },
  ],
);
assert.equal(linked.linkedBySunoId, 1);
assert.equal(linked.tracks[0].titleChanged, true);
assert.equal(linked.tracks[0].metadataChanged, true);
assert.equal(linked.tracks[0].hasLocalAudio, true);

const applyCatalog = [
  {
    id: "existing",
    title: "Fading Into You",
    audioUrl: "./audio.mp3",
    coverUrl: "./cover.jpeg",
    featured: true,
  },
];
const applyPlan = createApplicationPlan(source, applyCatalog);
assert.deepEqual(applyPlan.links, [
  { localId: "existing", sunoId: "suno-1", title: "FADING INTO YOU" },
]);
const initialSource =
  "window.DTRX_CATALOG = [{ id: 'existing', title: 'Fading Into You', audioUrl: './audio.mp3', coverUrl: './cover.jpeg', featured: true }];";
const updated = updateCatalogSource(initialSource, applyPlan.links);
assert.match(updated.source, /sunoId: 'suno-1'/);
assert.match(updated.source, /audioUrl: '\.\/audio\.mp3'/);
assert.match(updated.source, /featured: true/);
assert.equal(updated.changes.length, 1);
assert.equal(
  updateCatalogSource(updated.source, applyPlan.links).changes.length,
  0,
  "a second application must be idempotent",
);

assert.throws(
  () =>
    createApplicationPlan(
      {
        playlist: source.playlist,
        tracks: [{ sunoId: "suno-2", title: "Unknown Song" }],
      },
      applyCatalog,
    ),
  /no local catalog match/,
);
assert.throws(
  () =>
    createApplicationPlan(
      {
        playlist: source.playlist,
        tracks: [{ sunoId: "suno-2", title: "Fading Into You" }],
      },
      [{ ...applyCatalog[0] }, { ...applyCatalog[0], id: "duplicate" }],
    ),
  /matches multiple local records/,
);
assert.throws(
  () =>
    createApplicationPlan(
      {
        playlist: source.playlist,
        tracks: [
          { sunoId: "suno-1", title: "Fading Into You" },
          { sunoId: "suno-1", title: "Fading Into You" },
        ],
      },
      applyCatalog,
    ),
  /Duplicate Suno ID/,
);
assert.throws(
  () =>
    createApplicationPlan(source, [
      { ...applyCatalog[0], sunoId: "suno-1" },
      { id: "duplicate-suno", title: "Another Title", sunoId: "suno-1" },
    ]),
  /matches multiple local records/,
);

const renamed = createPreview(
  {
    playlist: source.playlist,
    tracks: [{ sunoId: "suno-1", title: "Renamed In Suno" }],
  },
  [{ ...applyCatalog[0], sunoId: "suno-1" }],
);
assert.equal(
  renamed.tracks[0].titleChanged,
  true,
  "a title change must be reported rather than written automatically",
);

const newManifest = {
  playlist: source.playlist,
  tracks: [
    ...source.tracks,
    {
      sunoId: "suno-3",
      title: "A New Release",
      duration: 210,
      style: "",
      visibility: "private",
    },
  ],
};
const staged = createStagingPlan(
  newManifest,
  catalog,
  require("node:path").join(__dirname, "missing-test-assets"),
);
assert.equal(staged.proposals.length, 1);
assert.equal(staged.proposals[0].proposedLocalId, "a-new-release");
assert.deepEqual(staged.proposals[0].pending, [
  "local-audio-required",
  "local-cover-optional",
  "style-metadata-missing",
]);
const collision = createStagingPlan(
  {
    playlist: source.playlist,
    tracks: [{ sunoId: "suno-4", title: "Existing" }],
  },
  [{ id: "existing", title: "Different" }],
  require("node:path").join(__dirname, "missing-test-assets"),
);
assert.match(collision.proposals[0].proposedLocalId, /^existing-suno4/);
const removed = createPreview({ playlist: source.playlist, tracks: [] }, [
  { id: "kept", sunoId: "suno-kept", title: "Kept" },
]);
assert.deepEqual(
  removed.removedFromPlaylist,
  [{ localId: "kept", sunoId: "suno-kept" }],
  "playlist removal is reported but never deletes the catalog record",
);

const projectCatalog = readCatalog(
  require("node:path").resolve(__dirname, "catalog.js"),
);
assert.ok(
  projectCatalog.some(
    (track) => track.id === "falling-into-blue" && track.audioUrl,
  ),
  "generated local assets must be included in the preview",
);

console.log("suno-sync tests passed");
