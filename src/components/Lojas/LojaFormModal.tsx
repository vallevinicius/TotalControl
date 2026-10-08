import { useState, type FormEvent } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { criarLoja, editarLoja, type DadosLojaPayload, type EdicaoLojaPayload } from '@/services/apiService';
import { cnpjValido, mascararCep, mascararCnpj, mascararTelefone } from '@/utils/mascaras';
import { TIPOS_EMPRESA, UFS } from '@/utils/empresa';
import { FUSOS_BRASIL, consultarCep, consultarCnpj } from '@/utils/consultas';
import { AuthInput } from '@/components/Auth/AuthInput';
import { AuthCombobox } from '@/components/Auth/AuthCombobox';
import { AuthCheckbox } from '@/components/Auth/AuthCheckbox';
import { ModalFundo } from '@/components/Admin/AdminModais';
import type { LojaGestao } from '@/types';

const CLASSE_SELECT =
  'mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-700/60 px-3 py-2.5 text-sm text-ink-100 focus:border-tenant focus:outline-none focus:ring-2 focus:ring-tenant/15';

function formularioDe(loja?: LojaGestao) {
  return {
    cnpj: loja?.cnpj ?? '',
    razaoSocial: loja?.razaoSocial ?? '',
    nomeFantasia: loja?.nomeFantasia ?? '',
    inscricaoEstadual: loja?.inscricaoEstadual ?? '',
    inscricaoMunicipal: loja?.inscricaoMunicipal ?? '',
    regimeTributario: loja?.regimeTributario ?? '',
    telefone: loja?.telefone ?? '',
    email: loja?.email ?? '',
    site: loja?.site ?? '',
    cep: loja?.endereco.cep ?? '',
    logradouro: loja?.endereco.logradouro ?? '',
    numero: loja?.endereco.numero ?? '',
    complemento: loja?.endereco.complemento ?? '',
    bairro: loja?.endereco.bairro ?? '',
    cidade: loja?.endereco.cidade ?? '',
    uf: loja?.endereco.uf ?? '',
    fusoHorario: loja?.fusoHorario ?? 'America/Sao_Paulo',
    exigirSenhaAoAbrirCaixa: loja?.exigirSenhaAoAbrirCaixa ?? false,
  };
}
type Formulario = ReturnType<typeof formularioDe>;

function Titulo({ children }: { children: string }) {
  return <p className="col-span-full mt-2 border-b border-ink-700 pb-2 text-xs font-semibold uppercase tracking-wider text-tenant">{children}</p>;
}

interface Props {
  /** Sem `loja` = criando uma nova; com `loja` = editando. */
  loja?: LojaGestao;
  /** Quando informado, a edição usa esta função em vez de `editarLoja(id)` (ex: dados da própria empresa, em qualquer plano). */
  salvarEdicao?: (dados: EdicaoLojaPayload) => Promise<void>;
  onFechar: () => void;
  onSalva: () => void;
}

export function LojaFormModal({ loja, salvarEdicao, onFechar, onSalva }: Props) {
  const toast = useToast();
  const editando = Boolean(loja);
  const [f, setF] = useState<Formulario>(() => formularioDe(loja));
  const [enviando, setEnviando] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);

  const set = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setF((atual) => ({ ...atual, [k]: v }));
  const campo = (k: Exclude<keyof Formulario, 'exigirSenhaAoAbrirCaixa'>) => ({
    value: f[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  });

  async function buscarCnpj() {
    if (!cnpjValido(f.cnpj)) return toast.erro('Informe um CNPJ válido para buscar os dados.');
    setBuscandoCnpj(true);
    const d = await consultarCnpj(f.cnpj);
    setBuscandoCnpj(false);
    if (!d) return toast.erro('Não encontramos esse CNPJ. Preencha os dados manualmente.');
    setF((atual) => ({
      ...atual,
      razaoSocial: d.razaoSocial ?? atual.razaoSocial,
      nomeFantasia: d.nomeFantasia ?? atual.nomeFantasia,
      telefone: d.telefone ?? atual.telefone,
      email: d.email ?? atual.email,
      cep: d.cep ?? atual.cep,
      logradouro: d.logradouro ?? atual.logradouro,
      numero: d.numero ?? atual.numero,
      complemento: d.complemento ?? atual.complemento,
      bairro: d.bairro ?? atual.bairro,
      cidade: d.cidade ?? atual.cidade,
      uf: d.uf ?? atual.uf,
    }));
    toast.sucesso('Dados preenchidos. Confira e complete o que faltar.');
  }

  async function aoDigitarCep(valor: string) {
    const cep = mascararCep(valor);
    set('cep', cep);
    const d = await consultarCep(cep);
    if (d) setF((atual) => ({ ...atual, logradouro: d.logradouro ?? atual.logradouro, bairro: d.bairro ?? atual.bairro, cidade: d.cidade ?? atual.cidade, uf: d.uf ?? atual.uf }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cnpjValido(f.cnpj)) return toast.erro('CNPJ inválido. Confira os números.');

    // Na edição, o campo vazio precisa ir como "" pra apagar o valor antigo; na
    // criação, vazio vira "não informado".
    const texto = (v: string) => (editando ? v.trim() : v.trim() || undefined);
    const dados: DadosLojaPayload = {
      nomeFantasia: f.nomeFantasia.trim(),
      razaoSocial: f.razaoSocial.trim(),
      cnpj: f.cnpj,
      inscricaoEstadual: texto(f.inscricaoEstadual),
      inscricaoMunicipal: texto(f.inscricaoMunicipal),
      regimeTributario: texto(f.regimeTributario),
      telefone: texto(f.telefone),
      email: texto(f.email),
      site: texto(f.site),
      cep: texto(f.cep),
      logradouro: texto(f.logradouro),
      numero: texto(f.numero),
      complemento: texto(f.complemento),
      bairro: texto(f.bairro),
      cidade: texto(f.cidade),
      uf: texto(f.uf),
    };

    setEnviando(true);
    try {
      if (loja) {
        const edicao = { ...dados, razaoSocial: dados.razaoSocial ?? '', fusoHorario: f.fusoHorario, exigirSenhaAoAbrirCaixa: f.exigirSenhaAoAbrirCaixa };
        await (salvarEdicao ? salvarEdicao(edicao) : editarLoja(loja.id, edicao));
        toast.sucesso('Loja atualizada.');
      } else {
        await criarLoja(dados);
        toast.sucesso(`Loja "${dados.nomeFantasia}" criada.`);
      }
      onSalva();
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao salvar a loja.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalFundo onFechar={onFechar}>
      <form onSubmit={handleSubmit} className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-ink-700 bg-ink-800">
        <div className="border-b border-ink-700 px-6 py-4">
          <p className="font-display text-lg font-semibold text-ink-100">{editando ? 'Editar loja' : 'Nova loja'}</p>
          <p className="text-sm text-ink-400">
            {editando ? loja!.nomeFantasia : 'Cria mais uma loja para a sua empresa, com dados totalmente separados. Você acessa todas com o mesmo login.'}
          </p>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-6">
          <Titulo>Dados da empresa</Titulo>
          <div className="sm:col-span-4">
            <AuthInput label="CNPJ *" required inputMode="numeric" maxLength={18} placeholder="00.000.000/0001-00" value={f.cnpj} onChange={(e) => set('cnpj', mascararCnpj(e.target.value))} />
          </div>
          <div className="flex items-end sm:col-span-2">
            <button type="button" onClick={buscarCnpj} disabled={buscandoCnpj || f.cnpj.replace(/\D/g, '').length !== 14}
              className="w-full rounded-lg border border-tenant/50 px-3 py-2.5 text-sm font-semibold text-tenant transition-colors hover:bg-tenant-soft disabled:cursor-not-allowed disabled:opacity-40">
              {buscandoCnpj ? 'Buscando…' : 'Buscar dados'}
            </button>
          </div>
          <div className="sm:col-span-3"><AuthInput label="Razão social *" required {...campo('razaoSocial')} /></div>
          <div className="sm:col-span-3"><AuthInput label="Nome fantasia *" required {...campo('nomeFantasia')} /></div>
          <div className="sm:col-span-3"><AuthInput label="Inscrição estadual" {...campo('inscricaoEstadual')} /></div>
          <div className="sm:col-span-3"><AuthInput label="Inscrição municipal" {...campo('inscricaoMunicipal')} /></div>
          <div className="sm:col-span-6">
            <AuthCombobox label="Tipo de empresa / regime tributário" value={f.regimeTributario} onChange={(v) => set('regimeTributario', v)} grupos={TIPOS_EMPRESA} placeholder="Escolha uma opção ou digite" />
          </div>

          <Titulo>Contato e endereço</Titulo>
          <div className="sm:col-span-2">
            <AuthInput label="Telefone" inputMode="numeric" maxLength={15} placeholder="(00) 00000-0000" value={f.telefone} onChange={(e) => set('telefone', mascararTelefone(e.target.value))} />
          </div>
          <div className="sm:col-span-2"><AuthInput label="E-mail da loja" type="email" {...campo('email')} /></div>
          <div className="sm:col-span-2"><AuthInput label="Site" {...campo('site')} /></div>
          <div className="sm:col-span-2">
            <AuthInput label="CEP" inputMode="numeric" maxLength={9} placeholder="00000-000" value={f.cep} onChange={(e) => aoDigitarCep(e.target.value)} />
          </div>
          <div className="sm:col-span-4"><AuthInput label="Rua / Avenida" {...campo('logradouro')} /></div>
          <div className="sm:col-span-2"><AuthInput label="Número" {...campo('numero')} /></div>
          <div className="sm:col-span-4"><AuthInput label="Complemento" {...campo('complemento')} /></div>
          <div className="sm:col-span-2"><AuthInput label="Bairro" {...campo('bairro')} /></div>
          <div className="sm:col-span-4"><AuthInput label="Cidade" {...campo('cidade')} /></div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-ink-300">
              Estado
              <select value={f.uf} onChange={(e) => set('uf', e.target.value)} className={CLASSE_SELECT}>
                <option value="">UF</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          </div>

          {editando && (
            <>
              <Titulo>Operação</Titulo>
              <div className="sm:col-span-3">
                <label className="block text-sm font-medium text-ink-300">
                  Fuso horário
                  <select value={f.fusoHorario} onChange={(e) => set('fusoHorario', e.target.value)} className={CLASSE_SELECT}>
                    {FUSOS_BRASIL.map((z) => <option key={z.valor} value={z.valor}>{z.rotulo}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex items-end pb-2.5 sm:col-span-3">
                <AuthCheckbox checked={f.exigirSenhaAoAbrirCaixa} onChange={(e) => set('exigirSenhaAoAbrirCaixa', e.target.checked)}>
                  Exigir senha ao abrir o caixa
                </AuthCheckbox>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-ink-700 px-6 py-4">
          <button type="button" onClick={onFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">Cancelar</button>
          <button type="submit" disabled={enviando} className="rounded-lg bg-tenant px-5 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:opacity-40">
            {enviando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Criar loja'}
          </button>
        </div>
      </form>
    </ModalFundo>
  );
}
