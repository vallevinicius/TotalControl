/* Service worker do Total Control: deixa o app abrir sem internet (o PDV segue vendendo).
 * Só guarda arquivos do próprio app (telas, estilos, ícones, fontes). NUNCA toca em /api: dados
 * e sessão passam sempre pela rede, e o app trata a falta de conexão por conta própria.
 * Para forçar todo mundo a baixar de novo, mude VERSAO. */
const VERSAO = 'tc-v1';
const MAX_ENTRADAS = 200;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function limitar(cache) {
  const chaves = await cache.keys();
  if (chaves.length > MAX_ENTRADAS) await Promise.all(chaves.slice(0, chaves.length - MAX_ENTRADAS).map((k) => cache.delete(k)));
}

async function guardar(requisicao, resposta) {
  if (!resposta || (!resposta.ok && resposta.type !== 'opaque')) return;
  const cache = await caches.open(VERSAO);
  await cache.put(requisicao, resposta.clone());
  limitar(cache);
}

/** Páginas: rede primeiro (sempre a versão nova quando há internet); sem rede, a última que abriu. */
async function paginaRedePrimeiro(requisicao) {
  try {
    const resposta = await Promise.race([fetch(requisicao), new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error('lento')), 4000))]);
    if (resposta.ok) await guardar('/', resposta); // todas as rotas do app usam o mesmo index.html
    return resposta;
  } catch {
    return (await caches.match('/')) || Response.error();
  }
}

/** Arquivos com hash no nome (/assets/...) nunca mudam: cache primeiro. */
async function cachePrimeiro(requisicao) {
  const guardada = await caches.match(requisicao);
  if (guardada) return guardada;
  const resposta = await fetch(requisicao);
  await guardar(requisicao, resposta);
  return resposta;
}

/** O resto (ícones, fontes): usa o que tem e atualiza em segundo plano. */
async function usaEAtualiza(requisicao) {
  const guardada = await caches.match(requisicao);
  const atualizando = fetch(requisicao)
    .then(async (r) => {
      await guardar(requisicao, r);
      return r;
    })
    .catch(() => undefined);
  return guardada || (await atualizando) || Response.error();
}

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  const mesmaOrigem = url.origin === self.location.origin;
  if (mesmaOrigem && url.pathname.startsWith('/api')) return; // dados: sempre rede

  if (req.mode === 'navigate') {
    evento.respondWith(paginaRedePrimeiro(req));
  } else if (mesmaOrigem && url.pathname.startsWith('/assets/')) {
    evento.respondWith(cachePrimeiro(req));
  } else if (mesmaOrigem || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    evento.respondWith(usaEAtualiza(req));
  }
});
