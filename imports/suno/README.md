# Importação aprovada do Suno

Cada lançamento precisa estar na playlist `DTRX | Official Releases` do
manifesto local antes de poder ser importado. Crie uma pasta com o ID oficial
do Suno, sem alterar arquivos do catálogo manualmente:

```text
imports/suno/<sunoId>/
  audio.mp3        # obrigatório; arquivo MP3 local aprovado
  cover.webp       # opcional (também pode ser cover.jpg ou cover.jpeg)
  lyrics.lrc       # opcional
  metadata.json    # opcional; complemento aprovado de título/artista/gênero
```

Exemplo, usando apenas um ID fictício:

```text
imports/suno/11111111-2222-3333-4444-555555555555/audio.mp3
```

Revise primeiro, sem escrever nada:

```powershell
npm run suno:import:preview
```

Depois de revisar o ID mostrado na prévia, aplique **somente aquele ID**:

```powershell
npm run suno:import:apply -- --confirm 11111111-2222-3333-4444-555555555555
```

`--apply` sem `--confirm` falha intencionalmente. Para aprovar mais de uma
música, informe cada ID de maneira explícita com outro `--confirm`. A aplicação
copia os arquivos para `public/music/<slug>/`, acrescenta apenas um novo
registro em `scripts/catalog.js` e nunca substitui mídias ou registros já
existentes. Pastas cujos IDs não estejam na Official Releases são bloqueadas.

`metadata.json` pode conter somente campos locais aprovados, por exemplo:

```json
{
  "title": "Título aprovado",
  "artist": "DTRX",
  "genre": "Melodic House"
}
```

O título do manifesto continua sendo usado quando `title` não for informado.
Nenhuma URL do Suno é usada como fonte de áudio.
