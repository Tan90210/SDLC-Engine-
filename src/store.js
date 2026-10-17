import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const uid = (prefix = '') => prefix + randomUUID();
export const now = () => new Date().toISOString();
export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'engine.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, project_id TEXT, action TEXT, created_at TEXT, detail TEXT);`);
  return {
    list() { return db.prepare('SELECT body FROM projects').all().map(r => JSON.parse(r.body)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); },
    get(id) { const r = db.prepare('SELECT body FROM projects WHERE id=?').get(id); return r ? JSON.parse(r.body) : null; },
    save(project, action, detail = '') {
      project.updatedAt = now(); project.revision = (project.revision || 0) + 1;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO projects(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(project.id, JSON.stringify(project));
        db.prepare('INSERT INTO audit(project_id,action,created_at,detail) VALUES(?,?,?,?)').run(project.id, action, now(), detail);
        db.exec('COMMIT');
      } catch(e) { db.exec('ROLLBACK'); throw e; }
      return project;
    },
    audit(id) { return db.prepare('SELECT action,created_at,detail FROM audit WHERE project_id=? ORDER BY id DESC LIMIT 200').all(id); },
    close() { db.close(); }
  };
}
export function newProject({ name, description = '', domain = 'Financial services', jurisdiction = 'Not specified' }) {
  return { id: uid('p-'), name, description, domain, jurisdiction, createdAt: now(), updatedAt: now(), revision: 0,
    stakeholders: [], messages: [], requirements: [], factors: {}, conflicts: [], analyses: [], knowledge: [] };
}
