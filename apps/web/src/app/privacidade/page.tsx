import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Privacidade e LGPD' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidade" updated="2 de novembro de 2026">
      <p>
        Esta política explica como o Barber Voice trata dados pessoais, em conformidade com a Lei Geral de
        Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>
      <h2>Papéis</h2>
      <p>
        Em relação aos dados dos <strong>clientes do estabelecimento</strong>, o estabelecimento é o{' '}
        <em>controlador</em> e o Barber Voice atua como <em>operador</em>, tratando os dados conforme as
        instruções do estabelecimento. Em relação aos dados de cadastro de usuários da plataforma, o Barber
        Voice é controlador.
      </p>
      <h2>Dados tratados</h2>
      <ul>
        <li>Usuários: nome, e-mail, senha (armazenada apenas como hash Argon2id), registros de acesso.</li>
        <li>
          Clientes do estabelecimento: nome, telefone, e-mail (opcional), histórico de agendamentos,
          preferências e observações autorizadas.
        </li>
        <li>
          Atendimentos (quando os canais estiverem ativos): mensagens, transcrições e, se habilitado e
          informado, gravações de chamadas.
        </li>
      </ul>
      <h2>Finalidades e bases legais</h2>
      <ul>
        <li>Agendamento e atendimento: execução de contrato e procedimentos preliminares (art. 7º, V).</li>
        <li>
          Comunicações de relacionamento e campanhas: consentimento, registrado com data, canal e evidência
          (art. 7º, I).
        </li>
        <li>Segurança e prevenção a fraudes: legítimo interesse e cumprimento de obrigação legal.</li>
      </ul>
      <h2>Segurança</h2>
      <ul>
        <li>
          Isolamento rigoroso de dados por estabelecimento, verificado também no banco de dados (Row-Level
          Security).
        </li>
        <li>
          Conexões criptografadas, segredos de integrações criptografados (AES-256-GCM) e trilha de auditoria.
        </li>
        <li>Acesso por papéis (proprietário, gerente, equipe) e área administrativa restrita e auditada.</li>
      </ul>
      <h2>Direitos dos titulares</h2>
      <p>
        Titulares podem solicitar acesso, correção, anonimização, portabilidade e revogação de consentimento.
        O painel permite ao estabelecimento atender essas solicitações, inclusive anonimizar o cadastro de um
        cliente.
      </p>
      <h2>Retenção</h2>
      <p>
        Dados são mantidos enquanto necessários às finalidades e obrigações legais. Os prazos específicos de
        retenção de gravações e conversas são configuráveis e serão detalhados na versão final desta política.
      </p>
    </LegalPage>
  );
}
