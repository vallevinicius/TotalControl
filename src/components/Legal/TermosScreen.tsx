import { dadoLegal } from '@/config/empresa';
import { LegalLayout } from './LegalLayout';

/** Texto padrão/genérico de mercado — ponto de partida pra revisão jurídica
 * antes de valer oficialmente. Os dados da empresa vêm de src/config/empresa.ts. */
export function TermosScreen() {
  return (
    <LegalLayout titulo="Termos de Uso" atualizadoEm="23 de setembro de 2026">
      <p>
        Estes Termos de Uso regulam o acesso e uso da plataforma Total Control ("Plataforma",
        "Serviço"), oferecida por {dadoLegal('razaoSocial')}, inscrita no CNPJ sob o nº
        {dadoLegal('cnpj')} ("Total Software", "nós"). Ao criar uma conta ou usar o Serviço, você
        ("Cliente", "você") concorda com estes Termos.
      </p>

      <h2>1. Descrição do serviço</h2>
      <p>
        O Total Control é um sistema de gestão para ponto de venda (PDV), controle de estoque,
        financeiro, clientes e equipe, oferecido no modelo de assinatura (SaaS — Software as a
        Service). As funcionalidades disponíveis variam conforme o plano contratado.
      </p>

      <h2>2. Cadastro e conta</h2>
      <ul>
        <li>Você é responsável por fornecer informações verdadeiras, completas e atualizadas no cadastro.</li>
        <li>Você é responsável por manter a confidencialidade das credenciais de acesso de todos os logins criados dentro da sua conta.</li>
        <li>A conta principal ("conta raiz") da loja não pode ser removida e é responsável pelas ações administrativas realizadas pelos demais usuários que ela criar.</li>
        <li>Você deve nos notificar imediatamente sobre qualquer uso não autorizado da sua conta.</li>
      </ul>

      <h2>3. Planos, teste grátis e pagamento</h2>
      <ul>
        <li>Novas contas têm direito a um período de teste grátis, conforme informado no momento do cadastro, sem necessidade de cartão de crédito.</li>
        <li>Após o período de teste, a continuidade do uso está condicionada à contratação de um plano pago.</li>
        <li>Os preços e limites de cada plano (usuários, produtos, lojas) são os informados na página de planos no momento da contratação e podem ser alterados mediante aviso prévio.</li>
        <li>O não pagamento pode resultar na suspensão do acesso à Plataforma até a regularização.</li>
      </ul>

      <h2>4. Uso aceitável</h2>
      <p>Ao usar a Plataforma, você concorda em não:</p>
      <ul>
        <li>Utilizar o Serviço para fins ilícitos ou que violem direitos de terceiros;</li>
        <li>Tentar acessar áreas, dados ou contas de outros clientes sem autorização;</li>
        <li>Realizar engenharia reversa, copiar ou revender a Plataforma sem autorização expressa;</li>
        <li>Inserir conteúdo malicioso ou tentar comprometer a segurança do sistema.</li>
      </ul>

      <h2>5. Propriedade intelectual</h2>
      <p>
        A Plataforma, sua marca, layout, código-fonte e demais elementos são de propriedade da
        Total Software. Os dados que você insere (produtos, clientes, vendas) continuam sendo de
        sua propriedade — usamos esses dados apenas para prestar o Serviço, conforme nossa
        Política de Privacidade.
      </p>

      <h2>6. Limitação de responsabilidade</h2>
      <p>
        O Serviço é fornecido "como está". Envidamos esforços razoáveis para manter a Plataforma
        disponível e livre de erros, mas não garantimos operação ininterrupta. Na máxima extensão
        permitida por lei, não nos responsabilizamos por lucros cessantes ou danos indiretos
        decorrentes do uso ou impossibilidade de uso do Serviço.
      </p>

      <h2>7. Cancelamento e suspensão</h2>
      <p>
        Você pode cancelar sua assinatura a qualquer momento. Podemos suspender ou encerrar contas
        que violem estes Termos, mediante aviso quando possível, exceto em casos de violação grave
        que exijam ação imediata.
      </p>

      <h2>8. Alterações nestes termos</h2>
      <p>
        Podemos atualizar estes Termos periodicamente. Alterações relevantes serão comunicadas
        pela Plataforma ou por e-mail antes de entrarem em vigor.
      </p>

      <h2>9. Contato</h2>
      <p>
        Dúvidas sobre estes Termos podem ser enviadas para {dadoLegal('emailContato')}.
      </p>
    </LegalLayout>
  );
}
