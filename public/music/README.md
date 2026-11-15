# Local music library

Create one stable, lowercase folder per public release:

```text
public/music/falling-into-blue/
  audio.mp3          required
  cover.webp         optional
  lyrics.lrc         optional
  visualizer.mp4     optional
  metadata.json      optional
```

`metadata.json` may contain only the fields you need. `durationSeconds` is useful
when the MP3 does not expose readable duration metadata during import.

```json
{
  "title": "Falling Into Blue",
  "artist": "DTRX",
  "genre": "",
  "durationSeconds": 0
}
```

Run `node scripts/import-local-music.js` from the project root. The importer finds
`audio.mp3`, reads basic ID3v1 title/artist/genre when present, applies metadata.json,
and updates `scripts/catalog.generated.js`. URLs use `./public/music/...`, which works
both locally and under the GitHub Pages `/dtrx-audio-lab/` project path.

Do not rename an existing folder after sharing its `#track/<folder-name>` link. Keep
distribution rights for every asset before committing it to the public repository.
