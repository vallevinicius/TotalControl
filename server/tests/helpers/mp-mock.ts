import http from 'node:http';

/** Mercado Pago de mentira (porta 4998, a mesma de MERCADOPAGO_API_URL nos testes):
 * guarda as assinaturas em memória e deixa o teste "pagar" uma delas. */
export interface AssinaturaFalsa {
  id: string;
  status: string;
  external_reference?: string;
  init_point: string;
  next_payment_date?: string;
  valor: number;
}

export function iniciarMercadoPagoFalso() {
  const assinaturas = new Map<string, AssinaturaFalsa>();
  const cobrancas = new Map<string, Array<Record<string, unknown>>>();
  let n = 0;
  const ler = (req: http.IncomingMessage) =>
    new Promise<Record<string, any>>((resolve) => {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => resolve(corpo ? JSON.parse(corpo) : {}));
    });

  const servidor = http.createServer(async (req, res) => {
    const enviar = (status: number, corpo: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    if (req.headers.authorization !== 'Bearer TESTE') return enviar(401, { message: 'token inválido' });

    const url = new URL(req.url!, 'http://x');
    if (req.method === 'POST' && url.pathname === '/preapproval') {
      const b = await ler(req);
      const id = `sub_${++n}`;
      const a: AssinaturaFalsa = { id, status: 'pending', external_reference: b.external_reference, init_point: `https://mp.test/checkout/${id}`, valor: b.auto_recurring.transaction_amount };
      assinaturas.set(id, a);
      return enviar(201, a);
    }
    if (req.method === 'GET' && url.pathname === '/authorized_payments/search') {
      const id = url.searchParams.get('preapproval_id')!;
      return enviar(200, { results: cobrancas.get(id) ?? [] });
    }
    const m = url.pathname.match(/^\/preapproval\/(.+)$/);
    if (m && req.method === 'GET') return assinaturas.has(m[1]) ? enviar(200, assinaturas.get(m[1])) : enviar(404, { message: 'não encontrada' });
    if (m && req.method === 'PUT') {
      const a = assinaturas.get(m[1]);
      if (!a) return enviar(404, { message: 'não encontrada' });
      Object.assign(a, await ler(req));
      return enviar(200, a);
    }
    enviar(404, { message: 'rota desconhecida' });
  });

  return {
    assinaturas,
    cobrancas,
    abrir: () => new Promise<void>((ok) => servidor.listen(4998, ok)),
    fechar: () => new Promise<void>((ok) => servidor.close(() => ok())),
    /** O cliente pagou no checkout: a assinatura passa a "authorized". */
    pagar(id: string) {
      const a = assinaturas.get(id)!;
      a.status = 'authorized';
      a.next_payment_date = new Date(Date.now() + 30 * 86_400_000).toISOString();
    },
  };
}
