import { Pool } from 'pg';
import { PgDocumentStore, ensureDocumentSchema } from '@openmaic/storage/document/pg';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import type { Scene, Stage } from '@/lib/types/stage';
import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import { createLogger } from '@/lib/logger';

const log = createLogger('PgDocumentPersist');

let pool: Pool | undefined;
let schemaReady: Promise<unknown> | undefined;

function getQueryable(): ConnectableQueryable {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required');
  if (!pool) {
    pool = new Pool({ connectionString });
    pool.on('connect', (client) => {
      client
        .query('SET idle_in_transaction_session_timeout = 30000')
        .catch((error) =>
          log.warn('persist-document pool: failed to set idle-in-transaction timeout', error),
        );
    });
  }
  return pool as unknown as ConnectableQueryable;
}

/**
 * Persist a generated classroom to the Postgres document store so it can be
 * listed, loaded, and deleted through the same persistence path the browser
 * uses. Best-effort: callers should treat a failure here as non-fatal (the
 * file-store classroom is the authoritative transport for the async path).
 */
/**
 * The LLM-generated stage/scenes can carry `undefined` members (e.g.
 * `stage.description`), which the Postgres document store rejects as "not a
 * plain JSON value". Round-tripping through JSON strips `undefined` members
 * and functions, yielding the plain-JSON shape the store validates.
 */
function toPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function saveClassroomToDocumentStore(stage: Stage, scenes: Scene[]): Promise<void> {
  const queryable = getQueryable();
  schemaReady ??= ensureDocumentSchema(queryable);
  await schemaReady;
  const store = new PgDocumentStore(queryable, {
    withTransaction: nodePostgresTransaction(queryable),
    validateScene: validateAppScene,
    validateStage: validateAppStage,
  });
  const plain = toPlainJson({ stage, scenes });
  await store.saveDocument(plain as Parameters<typeof store.saveDocument>[0]);
  log.info(`Saved classroom to Postgres document store: ${stage.id}`);
}
