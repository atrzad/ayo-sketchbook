import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const env = process.env;
const expandir = (p) => String(p || '').replace(/^~(?=$|\/)/, os.homedir());
const lista = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export const config = {
  raiz,
  porta: Number(env.PORTA || 3400),
  host: env.HOST || '127.0.0.1',
  dataDir: path.resolve(expandir(env.DATA_DIR || '~/.local/share/ayo-sketchbook')),
  ayoStdDb: path.resolve(expandir(env.AYO_STD_DB || '~/.local/share/ayo-std/ayo-std.sqlite')),
  ayoStdPerfis: path.resolve(expandir(env.AYO_STD_PERFIS || '~/Projects/ayo-std/config/perfis.json')),
  ayoStdUrl: (env.AYO_STD_URL || 'http://localhost:3300').replace(/\/$/, ''),
  cofreDono: env.COFRE_DONO ? path.resolve(expandir(env.COFRE_DONO)) : null,
  hosts: new Set(['localhost', '127.0.0.1', '[::1]', os.hostname().toLowerCase(), ...lista(env.HOSTS_EXTRAS)]),
  trustProxy: env.TRUST_PROXY === 'true' ? 'loopback' : false,
  sessaoDias: 30,
  publicDir: path.join(raiz, 'public'),
};
fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
