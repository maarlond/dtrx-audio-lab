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

## Letras sincronizadas

O modal acompanha automaticamente versos com tempos no arquivo `lyrics.lrc`:

```text
[00:17.83]We were running through the silence
[00:21.59]Chasing shadows in the dark
```

O tempo deve corresponder ao início real de cada verso no áudio da pasta. Letras
sem marcações continuam visíveis, mas não avançam automaticamente. As versões
temporizadas de `Falling Into Blue` e `Fading Into You` foram obtidas do
alinhamento oficial das respectivas faixas no Suno; os textos anteriores estão
preservados como `lyrics.original.txt` nas pastas dessas faixas. A reprodução
do site usa apenas os arquivos locais, sem consultar o Suno no navegador.
