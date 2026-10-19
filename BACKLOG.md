# Backlog — SupoClip (self-host local)

Notas locais de manutenção deste clone. Registra o que já foi aplicado e o que
fica pendente para uma próxima atualização.

**Última atualização:** 2026-10-18

> Este arquivo é local. Não faz parte do upstream `supoclip` — se o objetivo for
> contribuir de volta, cada item abaixo pode virar um PR separado.

---

## 0. Estado atual — mudanças locais ainda NÃO commitadas

Antes de mexer em qualquer coisa, saiba que este clone tem alterações locais não
commitadas (`git status`), feitas em sessão anterior justamente para tentar
resolver o download do YouTube:

| Arquivo | O que foi adicionado |
|---|---|
| `backend/src/youtube_utils.py` | `_default_youtube_extractor_args()` — força `player_client: ["mweb", "visionos", "web_embedded"]` e `player_skip: ["webpage"]`; e `_resolve_youtube_cookiefile()` — suporte a cookies |
| `backend/src/media/transcription.py` | Reaproveita as duas funções acima nas legendas do YouTube; adiciona `_assemblyai_language_code()` |
| `backend/tests/unit/test_assemblyai_polling.py` | Cobre o novo mapeamento de idioma (`pt_br` → `pt`, `en_us` → `en_us`) |
| `docker-compose.yml` | Adiciona o serviço `ollama` + volume `ollama_models`; reformatação no estilo prettier |

Dois pontos críticos:

1. **`player_client` com `mweb` é mudança LOCAL, não do upstream.** E é
   exatamente o cliente que hoje exige GVS PO Token — ver item 2.
2. **O suporte a cookies foi escrito no código, mas nunca foi ligado no
   Docker.** Ver item 2.1.

Sobre `_assemblyai_language_code()`: com `TRANSCRIPTION_LANGUAGE=pt_br` no `.env`,
o AssemblyAI recebia `pt_br` (código inválido). A mudança normaliza para `pt`,
preservando exceções regionais (`de_ch`, `en_au`, `en_uk`, `en_us`). A transcrição
já funcionava — isto é ganho de robustez, não correção de bug.

> **Decisão pendente:** esses 4 arquivos seguem sem commit. Decidir se viram
> commit local, PR para o upstream, ou se são descartados.

---

## 1. ✅ APLICADO — Análise do transcript falhava com HTTP 403 (OpenRouter)

### Sintoma

Toda tarefa de vídeo falhava no final do processamento com
`error_code = analysis_error` e a mensagem:

```
Transcript analysis failed: status_code: 403,
model_name: anthropic/claude-sonnet-5.5,
body: {'message': 'Key limit exceeded (total limit) ... $0.00 of $0.00 used; does not reset.'}
```

### Caminho do erro

```
backend/src/services/task_service.py:342   process_task
backend/src/services/video_service.py:549  process_video_complete → analyze_transcript
backend/src/services/video_service.py:210  analyze_transcript
backend/src/ai.py:1629                     get_most_relevant_parts_by_transcript → RuntimeError
backend/src/ai.py:1027                     _run_transcript_analysis → agent.run
```

A transcrição em si (AssemblyAI) sempre funcionou. O que falhava era a etapa
**seguinte**, em que o transcript é enviado ao LLM para escolher os trechos.

### Causa raiz

A chave da OpenRouter usada no `.env` tinha um **limite de gasto fixado em
US$ 0,00 que nunca reseta**. Confirmado via `GET https://openrouter.ai/api/v1/key`:

| Campo | Valor |
|---|---|
| `limit` | `0` |
| `limit_remaining` | `0` |
| `limit_reset` | `null` |
| `is_free_tier` | `true` |
| `effective_budget.limit_usd` | `0` |
| `effective_budget.spend_usd` | `0` |
| `effective_budget.resets_at` | `null` |
| `scope` | `key_limit` |

Como o limite é por **chave**, toda chamada retorna 403 independentemente de
haver crédito na conta. Além disso, o modelo configurado
(`anthropic/claude-sonnet-5.5`) é pago, e a conta é free tier.

### Correção aplicada

Em `.env` (linha ~87):

```diff
- LLM=openrouter:anthropic/claude-sonnet-5.5
+ LLM=google-gla:gemini-3-flash-preview
```

Depois: `docker compose up -d backend worker` (recriar os containers — mudança de
env não é aplicada por reload).

Provedores suportados, para referência (`backend/src/ai.py:458`):

```python
SUPPORTED_LLM_PROVIDERS = {"google", "google-gla", "openai", "openrouter", "anthropic", "ollama"}
```

### Verificação

Confirmado funcionando no log do worker:

```
"message": "AI analysis completed using model gemini-3-flash-preview"
```

### Como reverter para OpenRouter

1. Remover/aumentar o limite da chave em <https://openrouter.ai/settings/keys>.
2. Garantir crédito na conta (free tier não cobre modelos pagos).
3. Voltar o `LLM` para `openrouter:anthropic/claude-sonnet-5.5` e recriar
   `backend` + `worker`.

---

## 2. ⬜ PENDENTE — Download do YouTube falha de forma intermitente

Não é bug de configuração. É bloqueio anti-bot temporário do YouTube. Fica
registrado porque **voltará a acontecer**.

### Sintoma

`error_code = download_error`, `progress_message = Failed to download video`.

Ocorrências registradas:

| Task ID | URL | Falhou em | Duração |
|---|---|---|---|
| `28d0d85a-c76c-44db-ace4-e2bcee5f304a` | `watch?v=jn6ndA042rI` | 2026-10-17 14:49:36 | **21s** |
| `03364014-49b0-4a48-811d-433f99edd791` | `youtu.be/JdzPNbzh8ls` | 2026-10-17 14:53:05 | 191s |

### Causa raiz

O YouTube passou a exigir um **GVS PO Token** para o cliente `mweb`. O código
local (mudança não commitada — ver item 0) **força** esse cliente em
`player_client`, então quando o YouTube aperta a checagem o download toma `403`.
Capturado ao vivo no log do worker:

```
WARNING: [youtube] OTM1GFGCSx8: mweb client https formats require a GVS PO Token
which was not provided. They will be skipped as they may yield HTTP Error 403.
```

### Evidência de que é transitório

- As **duas URLs que falharam funcionam hoje**, com as opções exatas do app:
  metadados OK (`3840x2160`), formato escolhido `401+251-2` e **download real de
  mídia concluído**.
- No **mesmo dia** das falhas, uma tarefa criada às 15:56 baixou normalmente
  (só falhou depois, na análise — item 1). Ou seja, o download se recuperou
  sozinho em ~1 hora, sem nenhuma mudança de configuração.
- Versão do `yt-dlp`: `2026.08.19` (suporta resolução de desafio JS via `deno`,
  confirmado no log com `[jsc:deno] Solving JS challenges using deno`).

### Por que a falha de 21 segundos acontece

`backend/src/youtube_utils.py:539-545` — se a **leitura dos metadados** é
bloqueada, a função desiste **antes** de tentar baixar:

```python
video_info = get_youtube_video_info(url, task_id=task_id)
if not video_info:
    logger.error(f"Could not retrieve video information for: {url}")
    return None          # ← early return, não chega a tentar o download
```

### Agravantes na configuração atual

1. **Sem cookies.** `YOUTUBE_COOKIES_FILE` vazio e nenhum `cookies.txt` em
   `/app/uploads`. Sem cookies o YouTube trata o IP como suspeito.
2. **Sem fallback pago.** `APIFY_API_TOKEN` vazio ⇒ o provider secundário já
   implementado nunca é usado.
3. **Retry curto.** 3 tentativas com espera de apenas 1s e 2s
   (`youtube_utils.py:597-600`) — insuficiente para atravessar um bloqueio
   temporário.

### 2.1 ⚠️ Lacuna: `YOUTUBE_COOKIES_FILE` não é exposto no Docker

O código lê a variável (`backend/src/youtube_utils.py:43`) — mas atenção: essa
leitura também é **mudança local não commitada**, não faz parte do upstream:

```python
cookie_path = (os.getenv("YOUTUBE_COOKIES_FILE") or "").strip()
```

Mas ela **não existe** em:

- `.env.example`
- `docker-compose.yml` (nem em `backend`, nem em `worker`)
- `docs/configuration.md`

**Consequência:** mesmo que o usuário defina a variável no `.env`, ela não chega
ao container. Hoje não há forma suportada de usar cookies em Docker — só
editando o `docker-compose.yml` na mão.

**Correção sugerida:** adicionar a variável aos blocos `environment` de
`backend` e `worker` no `docker-compose.yml`, ao `.env.example` e à tabela de
`docs/configuration.md`. O caminho padrão (`<TEMP_DIR>/cookies.txt`) já funciona
sem variável, então também vale documentar que basta montar o arquivo em
`/app/uploads/cookies.txt`.

### 2.2 Ajustar `player_client`

`backend/src/youtube_utils.py:31-37`:

```python
def _default_youtube_extractor_args():
    return {"youtube": {"player_client": ["mweb", "visionos", "web_embedded"],
                        "player_skip": ["webpage"]}}
```

`mweb` é justamente o cliente que agora exige PO Token. Sugestão: incluir
clientes que não exigem token como fallback (ex.: `tv`, `web_safari`, `default`)
e/ou deixar o `yt-dlp` usar a ordem padrão dele. Validar antes/depois com o
procedimento de teste abaixo.

**Efeito colateral já observado — perda de qualidade.** Quando o `yt-dlp` pula os
formatos do `mweb`, a resolução cai. No download bem-sucedido de
`OTM1GFGCSx8`, os metadados ofereciam `3840x2160`, mas o arquivo baixado saiu em
**1920x1080**:

```
"message": "Download successful: OTM1GFGCSx8.mp4 (28MB, 1920x1080)"
```

Vale conferir se o `player_client` atual não está custando 4K nos clipes finais.

### 2.3 Endurecer retries

`backend/src/youtube_utils.py:555-616`: aumentar número de tentativas e o
backoff (hoje `2**attempt` ⇒ 1s, 2s). Um bloqueio anti-bot costuma durar mais
que isso.

### 2.4 Configurar `APIFY_API_TOKEN`

Adiciona o fallback pago que já está implementado em
`backend/src/youtube_utils.py:651-683`. Tem custo por uso. Se configurado,
`YOUTUBE_DOWNLOAD_PROVIDER=apify` inverte a ordem para tentar o Apify primeiro.

### Referências de código

| Local | O que é | Origem |
|---|---|---|
| `backend/src/youtube_utils.py:31-37` | `_default_youtube_extractor_args()` — lista de `player_client` | local |
| `backend/src/youtube_utils.py:40-49` | `_resolve_youtube_cookiefile()` — resolução do arquivo de cookies | local |
| `backend/src/youtube_utils.py:59-106` | `get_optimal_download_options()` — formato, headers, retries | upstream |
| `backend/src/youtube_utils.py:522-621` | `_download_youtube_video_with_ytdlp()` — early return + retry loop | upstream |
| `backend/src/youtube_utils.py:624-686` | `download_youtube_video()` — loop de providers (yt-dlp → Apify) | upstream |
| `backend/src/media/transcription.py` | `_assemblyai_language_code()` — normaliza `pt_br` → `pt` | local |
| `backend/src/services/video_service.py:441-454` | Etapa de download em `process_video_complete` | upstream |
| `docker-compose.yml:146-147` | `YOUTUBE_DOWNLOAD_PROVIDER` / `YOUTUBE_METADATA_PROVIDER` | upstream |
| `docker-compose.yml:127` | `APIFY_API_TOKEN` | upstream |

### Como validar uma mudança

Teste de metadados + seleção de formato, sem baixar o vídeo inteiro:

```bash
docker compose exec -T worker .venv/bin/python - <<'PY'
import sys; sys.path.insert(0, "/app")
import yt_dlp
from src.youtube_utils import YouTubeDownloader, _default_youtube_extractor_args

print("extractor_args =", _default_youtube_extractor_args())
d = YouTubeDownloader()
opts = d.get_optimal_download_options("TESTID")
opts["quiet"] = False
with yt_dlp.YoutubeDL(opts) as ydl:
    r = ydl.extract_info("https://www.youtube.com/watch?v=jn6ndA042rI", download=False)
print("formato:", r.get("format_id"), r.get("resolution"))
PY
```

Um download real (só 10 segundos, para não puxar o vídeo todo) confirma que a
mídia não toma 403:

```bash
docker compose exec -T worker .venv/bin/python - <<'PY'
import sys; sys.path.insert(0, "/app")
import yt_dlp
from src.youtube_utils import YouTubeDownloader

d = YouTubeDownloader()
opts = d.get_optimal_download_options("DIAGSECTION")
opts["outtmpl"] = str(d.temp_dir / "DIAGSECTION.%(ext)s")
opts["quiet"] = False
opts["download_ranges"] = lambda info, ydl: [{"start_time": 0, "end_time": 10}]
opts["force_keyframes_at_cuts"] = True
with yt_dlp.YoutubeDL(opts) as ydl:
    ydl.download(["https://www.youtube.com/watch?v=jn6ndA042rI"])
print("OK")
PY
```

> Lembrar de apagar o arquivo gerado depois:
> `docker compose exec -T worker rm -f /app/uploads/DIAGSECTION.mp4`

---

## 3. ⬜ PENDENTE — Deploy na VPS via Dokploy

Preparado em 2026-10-18. O clone **não estava pronto** para publicar; os
bloqueadores foram levantados e resolvidos com dois arquivos novos.

### Arquivos criados

| Arquivo | Para que serve |
|---|---|
| `docker-compose.dokploy.yml` | Variante de produção do compose. É o arquivo que a Dokploy deve usar |
| `.env.production.example` | Template de variáveis de ambiente de produção (só placeholders) |
| `.gitignore` | Liberado `!.env.production.example` (caía na regra `.env.*`) |

O `docker-compose.yml` original **continua intacto** para desenvolvimento local.

### O que o compose de produção corrige

1. **`target: runner`** no frontend. O compose original usa
   `${FRONTEND_BUILD_TARGET:-development}`, ou seja, `pnpm run dev` (hot-reload).
   O estágio de produção do Dockerfile chama-se `runner` — **não** `production`.
2. **Sem bind mounts de código.** Removidos `./frontend/src`, `./frontend/public`,
   `./frontend/prisma`, `./backend/src`, `./backend/fonts`,
   `./backend/transitions`. Fonts e transitions já são copiados para a imagem
   (`backend/Dockerfile:50-51`), então os mounts eram redundantes. A doc da
   Dokploy avisa que mounts relativos do repositório podem ficar vazios, porque
   cada deploy faz um `git clone` novo.
3. **Senha do Postgres parametrizada.** O upstream hardcodava
   `supoclip_password` em quatro lugares (o próprio app documenta essa pegadinha:
   editar só o `.env` não muda nada). Agora a `DATABASE_URL` dos três serviços
   herda `${POSTGRES_PASSWORD}`.
4. **`expose` em vez de `ports`.** Só a rede interna do Docker alcança; o Traefik
   da Dokploy roteia o domínio público.
5. **Rede `dokploy-network`** (external) em todos os serviços, no lugar de
   `supoclip-network`, para o Traefik conseguir rotear.
6. **`YOUTUBE_COOKIES_FILE` exposto** em backend e worker — resolve o item 2.1.
7. **Sem o serviço `ollama`** (economiza 9,37 GB de imagem e RAM parada).
8. **`platform` configurável** via `BACKEND_PLATFORM` (`linux/amd64` por padrão,
   `linux/arm64` para VPS ARM).

### Passos manuais que faltam

1. **Comprar/definir o domínio** e criar dois registros A apontando para a VPS:
   `supoclip.seudominio.com` (frontend) e `api.seudominio.com` (backend).
2. **Gerar os segredos** (`openssl rand -hex 32`) para `BETTER_AUTH_SECRET`,
   `BACKEND_AUTH_SECRET` e `APP_SETTINGS_ENCRYPTION_KEY`; e `openssl rand -hex 24`
   para `POSTGRES_PASSWORD` e `REDIS_PASSWORD`.
3. **Na Dokploy:** criar um serviço *Docker Compose*, apontar
   **Compose Path** para `./docker-compose.dokploy.yml`, e colar o `.env`
   preenchido no painel **Environment**.
4. **Na Dokploy:** adicionar os dois domínios na aba *Domains* —
   frontend na porta `3107`, backend na porta `8000`.
5. **Commitar** as mudanças locais pendentes (ver item 0) antes do deploy —
   `git clone` só traz o que está commitado.

### Por que o backend precisa de domínio público

Com `BACKEND_AUTH_SECRET` definido, `hasSignedBackendAuth()` é `true` e o
frontend devolve ao **navegador** uma URL de upload direto:

```ts
// frontend/src/app/api/upload/authorization/route.ts:45-51
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
return NextResponse.json({
  directUpload: true,
  uploadUrl: `${normalizedApiUrl}/upload`,   // ← consumido pelo navegador
```

Se `NEXT_PUBLIC_API_URL` apontar para `localhost`, o upload aponta para a máquina
de quem está acessando. Por isso: **dois domínios**, sendo o backend público.

### Cuidados operacionais

- **`NEXT_PUBLIC_*` é build arg.** Alterar depois exige **rebuild**, não restart.
- **Tamanho:** backend e worker somam ~9 GB de imagem (4,57 GB cada, mesmo build).
  Full build no VPS demora e consome disco.
- **Schema do banco:** `init.sql` roda **só na primeira inicialização** do volume
  Postgres. Depois disso, nada atualiza o schema sozinho. Em upgrade que adicione
  arquivos em `frontend/prisma/migrations` ou `backend/migrations`, aplique
  manualmente (o app documenta o procedimento). Nunca rode
  `docker compose down -v` num ambiente com dados.
- **Sem SES:** login e cadastro funcionam, mas "esqueci a senha" e "verificar
  email" não enviam nada.
- **Backup:** os volumes `uploads` e `clips` guardam os vídeos; o volume
  `postgres_data` guarda o banco. A Dokploy faz backup de *named volumes* — não
  de bind mounts.

---

## 4. ✅ APLICADO — Títulos, descrições e hashtags virais por corte

Pedido do usuário: gerar automaticamente títulos e descrições com apelo viral
para cada corte, respeitando os limites de cada plataforma.

### O que já existia (e por que não bastava)

| Peça | Antes |
|---|---|
| `hook_title` | Já gerado pelo LLM, mas é um **headline de overlay** (3-9 palavras, queimado no vídeo) — objetivo diferente de título de feed |
| Descrição | `clip.text` — a **transcrição crua** do trecho, sem gancho nem CTA |
| Hashtags | Sempre vazio, 100% manual |
| `social_posts` | Já aceitava `title`, `caption`, `hashtags` — não precisou mudar |

### O que foi construído

Uma chamada de modelo **separada da seleção de cortes** (não mexe no prompt de
viralidade, que é afinado e já é longo), com um botão para regerar sem refazer a
análise.

Shape armazenado em `generated_clips.publishing_metadata` (JSONB):

```json
{
  "generic": { "title": "...", "description": "...", "hashtags": ["..."] },
  "platforms": {
    "youtube":   { "title": "...", "description": "...", "hashtags": ["..."] },
    "tiktok":    { "title": "...", "description": "...", "hashtags": ["..."] },
    "instagram": { "title": "...", "description": "...", "hashtags": ["..."] }
  },
  "generated_at": "2026-10-18T22:44:28.549754"
}
```

Limites aplicados no backend (truncagem em limite de palavra, descrição em limite
de frase/palavra):

| Plataforma | Título | Descrição | Hashtags |
|---|---|---|---|
| youtube | 100 | 5000 | 15 |
| tiktok | 150 | 2200 | 10 |
| instagram | 150 | 2200 | 30 |
| generic | 100 | 2200 | 15 |

Regras de higiene: hashtags sem `#`, sem espaços, sem duplicatas (case-insensitive)
e com o token inteiro removido do título/descrição; markdown (`**negrito**`,
listas, cercas) removido; a descrição nunca carrega hashtag no corpo.

### Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `backend/src/migrations/sql/20261018_0001_clip_publishing_metadata.sql` | Adiciona a coluna JSONB (novo) |
| `backend/src/models.py` | `GeneratedClip.publishing_metadata` |
| `backend/src/ai.py` | `PlatformCopy`, `ClipsPublishingCopy`, `ClipsPublishingMetadata`, prompt, sanitizadores, `normalize_publishing_metadata()`, `generate_clips_publishing_metadata()` |
| `backend/src/repositories/clip_repository.py` | Lê/grava a coluna (com fallback se a coluna não existir) |
| `backend/src/services/task_service.py` | `generate_clip_publishing_metadata()` + hook no pipeline |
| `backend/src/api/routes/tasks.py` | `POST /tasks/{task_id}/clips/{clip_id}/publishing-metadata` |
| `frontend/src/components/clip-publisher.tsx` | Pré-preenche título/descrição/hashtags e botão **Generate with AI / Regenerate** |
| `frontend/src/app/tasks/[id]/page.tsx` | Tipo `Clip` + refresh após gerar |

### Como roda

1. **Automático:** ao final do pipeline, depois de renderizar os cortes, o
   serviço gera os textos (progresso «Writing viral titles and descriptions...»).
   É **best-effort**: se o modelo falhar, a geração continua e só fica um
   `logger.exception` — um corte renderizado nunca é perdido por causa de texto.
2. **Manual:** o botão no painel de publicação chama o endpoint novo, que força a
   regeração daquele corte e devolve o clipe atualizado.

O publicador já escolhe a variante da plataforma da conta selecionada e cai para
o `generic` quando aquela plataforma não tem variante própria.

### Migração

A coluna **não** vem do `init.sql` (que só roda na primeira inicialização do
volume). O backend aplica migrations do diretório
`backend/src/migrations/sql/` no boot (`src/database.py:118-142`), então basta
reiniciar `backend` e `worker`. Confirme com:

```bash
docker exec supoclip-postgres psql -U supoclip -d supoclip \
  -c "SELECT column_name FROM information_schema.columns
      WHERE table_name='generated_clips' AND column_name='publishing_metadata';"
```

`create_all` **não** adiciona colunas a tabelas existentes — em bancos antigos a
migration é obrigatória.

### Testes

- `backend/tests/unit/test_publishing_metadata.py` — 14 testes (sanitizadores,
  limites por plataforma, fallback para o `generic`, batching 5+5+2, prompt).
- `backend/tests/unit/test_task_service.py` — 2 testes novos: o pipeline grava os
  textos, e uma falha do modelo **não** derruba a geração.
- `frontend/src/components/clip-publisher.test.tsx` — 5 testes novos (pré-preenchimento
  por plataforma, fallback, sem cópia gerada, geração sob demanda, erro na tela).

### Limitações conhecidas / trabalho futuro

1. **Sem salvar edição manual.** Se o usuário editar o texto no painel e publicar,
   a edição vai para o post, mas não volta para `publishing_metadata`. Reabrir o
   painel mostra o texto gerado.
2. **Sem idioma explícito.** O prompt manda escrever no idioma do transcript; não
   há parâmetro de idioma por tarefa.
3. **Sem aprendizado de performance.** `social_service.py` já agrega métricas por
   `hook_type`; dá para alimentar o gerador com o histórico do criador, como o
   reranker já faz.
4. **Trocar de conta troca o texto.** Ao mudar a conta no painel, a variante
   daquela plataforma substitui o que estiver escrito — inclusive edições manuais
   não salvas.

---

## Comandos úteis de diagnóstico

```bash
# Tarefas com erro, agrupadas
docker compose exec -T postgres psql -U supoclip -d supoclip \
  -c "SELECT error_code, COUNT(*), MIN(created_at), MAX(created_at) FROM tasks GROUP BY error_code;"

# Últimas tarefas, com URL de origem
docker compose exec -T postgres psql -U supoclip -d supoclip \
  -c "SELECT t.id, t.status, t.progress, t.error_code, t.created_at, s.url FROM tasks t LEFT JOIN sources s ON s.id=t.source_id ORDER BY t.created_at DESC LIMIT 10;"

# Log do worker filtrando o que importa
docker compose logs worker --since 30m 2>&1 | Select-String -Pattern "process_video_task|Download|analysis|ERROR"
```
