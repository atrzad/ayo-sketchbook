// Login com as contas do Ayo Std: a senha é conferida contra o hash de lá; a sessão é daqui.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db, bancoAyoStd } from './db.js';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const DIA = 864e5;
export const COOKIE = 'ayo_sketch';
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function conferirSenha(senha, armazenado) {
  const [alg, N, r, p, sal, hash] = String(armazenado).split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(hash, 'base64');
  const obtido = await scrypt(senha, Buffer.from(sal, 'base64'), esperado.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(obtido, esperado);
}
const FALSO = 'scrypt$16384$8$1$' + crypto.randomBytes(16).toString('base64') + '$' + crypto.randomBytes(64).toString('base64');

let perfis = {};
try { perfis = JSON.parse(fs.readFileSync(config.ayoStdPerfis, 'utf8')); } catch {}
const temaPadrao = (perfil) => (perfis[perfil]?.tema === 'normal' ? 'normal' : 'pixel');

function usuarioPorId(id) {
  const u = bancoAyoStd().prepare(`SELECT id, usuario, arroba, nome, perfil, dono, tema, confirmacao_pendente, trocar_senha FROM usuarios WHERE id = ?`).get(id);
  if (!u || u.confirmacao_pendente || u.trocar_senha) return null;
  return { id: u.id, arroba: u.arroba || u.usuario.toLowerCase(), nome: u.nome || u.usuario, dono: !!u.dono, tema: u.tema || temaPadrao(u.perfil) };
}

export async function autenticar(login, senha) {
  const l = String(login).trim().replace(/^@/, '');
  const u = bancoAyoStd().prepare(`SELECT id, senha_hash, confirmacao_pendente, trocar_senha FROM usuarios
    WHERE usuario = ? COLLATE NOCASE OR arroba = lower(?) OR (email = lower(?) AND email_confirmado = 1)`).get(l, l, l);
  const ok = await conferirSenha(senha, u ? u.senha_hash : FALSO);
  if (!ok || !u) return { erro: 'Usuário ou senha incorretos.' };
  if (u.confirmacao_pendente) return { erro: 'Confirme seu e-mail no Ayo Std antes de entrar.' };
  if (u.trocar_senha) return { erro: 'Sua senha é provisória. Crie a sua no Ayo Std (Configurações) e volte aqui.' };
  return { id: u.id };
}

function definirCookie(req, res, valor, ms) {
  res.cookie(COOKIE, valor, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: ms });
}

export function criarSessao(req, res, usuarioId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, criada, expira) VALUES (?, ?, ?, ?)').run(hashToken(token), usuarioId, Date.now(), Date.now() + config.sessaoDias * DIA);
  definirCookie(req, res, token, config.sessaoDias * DIA);
}

export function encerrarSessao(req, res) {
  if (req.sessaoHash) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(req.sessaoHash);
  res.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: req.secure });
}

function lerCookie(req) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === COOKIE) { try { return decodeURIComponent(parte.slice(i + 1).trim()); } catch { return null; } }
  }
  return null;
}

// A conta é relida do Ayo Std a cada pedido: removida lá = sem acesso aqui na hora.
export function carregarSessao(req, res, next) {
  const token = lerCookie(req);
  if (token) {
    const h = hashToken(token);
    const s = db.prepare('SELECT usuario_id, expira FROM sessoes WHERE token_hash = ? AND expira > ?').get(h, Date.now());
    if (s) {
      const u = usuarioPorId(s.usuario_id);
      if (u) {
        req.usuario = u;
        req.sessaoHash = h;
        if (Date.now() + config.sessaoDias * DIA - s.expira > DIA) {
          db.prepare('UPDATE sessoes SET expira = ? WHERE token_hash = ?').run(Date.now() + config.sessaoDias * DIA, h);
          definirCookie(req, res, token, config.sessaoDias * DIA);
        }
      } else {
        db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(h);
      }
    }
  }
  next();
}

const falhas = new Map();
export function bloqueado(ip) {
  const f = falhas.get(ip);
  return f && Date.now() - f.inicio < 15 * 60_000 && f.n >= 6;
}
export function falhou(ip) {
  const f = falhas.get(ip);
  if (!f || Date.now() - f.inicio > 15 * 60_000) falhas.set(ip, { n: 1, inicio: Date.now() }); else f.n++;
}
export const limparFalhas = (ip) => falhas.delete(ip);
setInterval(() => { db.prepare('DELETE FROM sessoes WHERE expira < ?').run(Date.now()); }, 3600_000).unref();
