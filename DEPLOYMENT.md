# Deployment Guide — ygslife.org instance

Operations documentation for this self-hosted OpenMAIC deployment. Upstream
documentation ([README.md](README.md), [packages/docs](packages/docs/)) covers
the product generally; this file records how **this** instance is run.

## Layout

| What | Where |
| --- | --- |
| Deployed version | upstream tag `v1.4.2` (branch `upgrade/v1.4.2`) |
| Pre-upgrade fork | branch `backup/pre-v1.4.2` (last custom commit `c31d0c9`) |
| Upstream base | `main` (tracks `origin/main`) |
| Instance config | `openmaic.yml` (committed, no secrets — `${VAR}` references) |
| Compose override | `docker-compose.override.yml` (committed) |
| Secrets | `.env.local` (gitignored) — API keys, `DATABASE_URL`, `ACCESS_CODE`, `OPENMAIC_SECRET_KEY` |
| Compose interpolation | `.env` (gitignored) — `OPENMAIC_PUBLISH_ADDRESS=0.0.0.0` |
| Backups | `/home/benny/openmaic-backups/pre-v1.4.2/` |

## Runtime

- Docker Compose; only the `openmaic` service runs (`--no-deps`): the bundled
  `postgres` service is intentionally not started because the app uses an
  **external PostgreSQL** (`DATABASE_URL` in `.env.local`, host
  `litellm-postgres` on the external `litellm_litellm-net` network).
- Published on `0.0.0.0:3000` (`OPENMAIC_PUBLISH_ADDRESS` in `.env`), served
  publicly at `https://openmaic.ygslife.org` (`APP_ORIGIN`) behind a reverse
  proxy.
- Single-user mode: `OWNER_SINGLE_USER=true`, `OWNER_SINGLE_USER_ID=local`.
  Protected by `ACCESS_CODE` (required — the app is published beyond loopback).

## Models (`openmaic.yml`)

The gateway is a local LiteLLM instance (`http://litellm:4000/v1`, `openai`
preset). `openmaic.yml` is read **once at startup** — restart after changes.

Allowlist (refreshed 2026-11-11 against the gateway's `/v1/models`; kimi +
glm + step families, 13 models):

- Kimi: `k3.1-pro`, `k3.1-pro-cc`, `k3.1-pro-highspeed`
- GLM: `glm-5.2`, `glm-5.2-cc`, `glm-5.3`, `glm-5.3-cc`, `glm-5.3-flash`,
  `glm-5.3-flash-cc`
- Step: `step-3.5-flash`, `step-3.5-flash-2603`, `step-3.7-flash`,
  `step-5-preview`

Slot assignments:

- `llm`: `openai:glm-5.3-flash` (default chat; classroom chat and the
  workbench agent inherit it — both need tool calling; if the gateway refuses,
  pin them to `glm-5.3-flash-cc`)
- `course.content.slide` / `course.content.interactive`: `openai:k3.1-pro`,
  thinking disabled
- `tts`: `qwen-tts:qwen3-tts-flash` (DashScope; voice-clone target
  `cosyvoice-v3.5-plus` allowlisted)

Legacy provider variables (`OPENAI_*`, `TTS_QWEN_*`, `DEFAULT_MODEL`,
`MODEL_ROUTES`) are retired: with `openmaic.yml` present, slot resolution uses
only the file.

## Data migration (0.3.2-era → v1.4.2)

Applied 2026-11-10. The v1.3/v1.4 schema migrations are one-way — **rollback
requires a database restore**, not a container swap.

Beyond the automatic 50 schema migrations, an ownership bridge was applied
 manually (courses from the pre-owner era had no `stage_meta` rows):

1. `stage_meta` rows for the pre-upgrade courses → owner `local`
   ([post-cutover-ownership.sql](/home/benny/openmaic-backups/pre-v1.4.2/post-cutover-ownership.sql))
2. `asset_entries.principal` → `owner:local` (the app derives per-owner
   partitions as `owner:<ownerId>`)
3. `asset_entries.committed_at` backfilled from legacy epoch-millis
   `created_at`
4. `document_asset_refs` backfilled from the live documents (protects
   referenced media from the unreferenced-byte collector; keep
   `ASSET_COLLECTION_GRACE_MS` ≥ 45 minutes)

## Backups & rollback

`/home/benny/openmaic-backups/pre-v1.4.2/` holds the pre-upgrade state:

- `openmaic-db.dump` / `openmaic-db-cutover.dump` (custom-format `pg_dump`)
- `openmaic-data-volume.tar.gz` / `openmaic-data-volume-cutover.tar.gz`
- pre-upgrade `.env.local`, old compose override, the ownership SQL

Rollback: stop the stack → restore the DB dump into `litellm-postgres` →
restore the volume tar → `git checkout backup/pre-v1.4.2` → run image
`openmaic-openmaic:pre-v1.4.2`. Never downgrade the container against a
migrated database.

## Legacy-course bridge (temporary)

`openmaic-bridge` runs the **old** image on `127.0.0.1:3001` against isolated
copies (`openmaic-bridge-db`, `openmaic-bridge-data`) for browser-side
export/import of pre-upgrade courses. Teardown once satisfied:

```bash
docker rm -f openmaic-bridge openmaic-bridge-db
docker volume rm openmaic-bridge-db openmaic-bridge-data
docker network rm openmaic-bridge
```

## Future upgrades

1. Read the target release's breaking changes (releases since v1.4.2: mixed
   versions are refused once migrations run).
2. `pg_dump` + volume tar while stopped; verify the dump with `pg_restore --list`.
3. Restore the dump into a scratch database and boot the new image against it
   (the preflight pattern used for this upgrade) before touching production.
4. `docker compose up -d --build --no-deps openmaic`.
