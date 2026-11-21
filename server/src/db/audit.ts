import type { Db } from './index.js';

export interface AuditEntry {
  actorId: number | null;
  action: string;
  entity: string;
  entityId?: string | null;
  /** Must never contain names, phones, comments or other personal data. */
  meta?: Record<string, string | number | boolean | null> | null;
}

export function writeAudit(db: Db, entry: AuditEntry, createdAt: string): void {
  db.prepare(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    entry.actorId,
    entry.action.slice(0, 64),
    entry.entity.slice(0, 32),
    entry.entityId ?? null,
    entry.meta ? JSON.stringify(entry.meta) : null,
    createdAt
  );
}

export function deleteOldAudit(db: Db, olderThanIso: string): number {
  const result = db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(olderThanIso);
  return result.changes;
}
