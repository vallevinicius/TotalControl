import { dadoLegal } from '@/config/empresa';
import { LegalLayout } from './LegalLayout';

/** Texto padrão/genérico de mercado, baseado nos princípios da LGPD —
 * ponto de partida pra revisão jurídica antes de valer oficialmente. Os
 * dados da empresa (razão social, CNPJ, e-mail do encarregado/DPO) vêm de
 * src/config/empresa.ts. */
export function PrivacidadeScreen() {
  return (
    <LegalLayout titulo="Política de Privacidade" atualizadoEm="23 de setembro de 2026">
      <p>
        Esta Política de Privacidade explica como {dadoLegal('razaoSocial')}, inscrita
        no CNPJ sob o nº {dadoLegal('cnpj')} ("Total Software", "nós"), coleta, usa e protege os
        dados pessoais de quem usa a plataforma Total Control, em conformidade com a Lei Geral de
        Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>

      <h2>1. Quais dados coletamos</h2>
      <ul>
        <li>Dados de cadastro: nome, e-mail, telefone, CNPJ da loja, e a senha de acesso (armazenada de forma criptografada).</li>
        <li>Dados operacionais inseridos por você no uso do sistema: produtos, clientes, vendas, lançamentos financeiros e configurações da loja.</li>
        <li>Dados técnicos: registros de acesso e ações relevantes (log de auditoria), para fins de segurança e suporte.</li>
      </ul>

      <h2>2. Como usamos os dados</h2>
      <ul>
        <li>Para viabilizar o funcionamento da Plataforma (autenticação, isolamento dos dados de cada loja, cálculo de relatórios);</li>
        <li>Para comunicação sobre sua conta, cobrança e atualizações relevantes do Serviço;</li>
        <li>Para suporte técnico, quando você entra em contato;</li>
        <li>Para cumprir obrigações legais ou regulatórias, quando aplicável.</li>
      </ul>
      <p>Não vendemos seus dados pessoais nem os dados dos seus clientes cadastrados na Plataforma para terceiros.</p>

      <h2>3. Com quem compartilhamos dados</h2>
      <p>
        Podemos compartilhar dados com prestadores de serviço que nos ajudam a operar a Plataforma
        (ex: hospedagem/infraestrutura), sempre sob obrigação contratual de confidencialidade, ou
        quando exigido por lei ou ordem judicial.
      </p>

      <h2>4. Seus direitos como titular de dados</h2>
      <p>Nos termos da LGPD, você tem direito a:</p>
      <ul>
        <li>Confirmar a existência de tratamento e acessar seus dados;</li>
        <li>Corrigir dados incompletos, inexatos ou desatualizados;</li>
        <li>Solicitar a portabilidade dos seus dados a outro fornecedor;</li>
        <li>Solicitar a exclusão dos dados pessoais tratados, quando aplicável;</li>
        <li>Revogar o consentimento, quando o tratamento for baseado nele.</li>
      </ul>
      <p>
        Para exercer esses direitos, entre em contato pelo e-mail {dadoLegal('emailDpo')}.
      </p>

      <h2>5. Cookies e tecnologias semelhantes</h2>
      <p>
        Usamos armazenamento local do navegador (localStorage) para manter sua sessão logada e
        lembrar preferências (como o tema claro/escuro), não para rastreamento publicitário.
      </p>

      <h2>6. Segurança</h2>
      <p>
        Adotamos medidas técnicas razoáveis para proteger seus dados, como senhas armazenadas de
        forma criptografada e isolamento dos dados entre diferentes lojas/contas. Nenhum sistema é
        100% imune a incidentes, e trabalhamos continuamente para reduzir esse risco.
      </p>

      <h2>7. Retenção de dados</h2>
      <p>
        Mantemos seus dados enquanto sua conta estiver ativa e pelo tempo necessário para cumprir
        obrigações legais, fiscais ou contratuais após o encerramento, quando aplicável.
      </p>

      <h2>8. Alterações nesta política</h2>
      <p>
        Podemos atualizar esta política periodicamente. A data da última atualização está sempre
        indicada no topo desta página.
      </p>

      <h2>9. Contato</h2>
      <p>
        Dúvidas sobre esta Política de Privacidade ou sobre o tratamento dos seus dados podem ser
        enviadas para {dadoLegal('emailDpo')}.
      </p>
    </LegalLayout>
  );
}
