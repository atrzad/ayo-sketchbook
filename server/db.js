// Banco próprio do Sketchbook: só sessões e preferências. As contas são as do Ayo Std (lidas, nunca alteradas).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(path.join(config.dataDir, 'sketchbook.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
const MIGRACOES = [
  `CREATE TABLE sessoes (token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, criada INTEGER NOT NULL, expira INTEGER NOT NULL);
   CREATE TABLE preferencias (usuario_id INTEGER PRIMARY KEY, valor TEXT NOT NULL);`,
];
{
  const v = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = v; i < MIGRACOES.length; i++) {
    db.exec('BEGIN');
    try { db.exec(MIGRACOES[i]); db.exec(`PRAGMA user_version = ${i + 1}`); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

export function lerPreferencias(id) {
  try { return JSON.parse(db.prepare('SELECT valor FROM preferencias WHERE usuario_id = ?').get(id)?.valor || '{}'); } catch { return {}; }
}
export function gravarPreferencias(id, valor) {
  db.prepare('INSERT INTO preferencias (usuario_id, valor) VALUES (?, ?) ON CONFLICT DO UPDATE SET valor = excluded.valor').run(id, JSON.stringify(valor));
}

// Banco do Ayo Std, só leitura: contas, senhas, tema.
let std = null;
export function bancoAyoStd() {
  if (!std) {
    if (!fs.existsSync(config.ayoStdDb)) throw new Error(`Banco do Ayo Std não encontrado em ${config.ayoStdDb}`);
    std = new DatabaseSync(config.ayoStdDb, { readOnly: true });
    std.exec('PRAGMA busy_timeout = 5000;');
  }
  return std;
}
