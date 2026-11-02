import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Termos de uso' };

export default function TermsPage() {
  return (
    <LegalPage title="Termos de uso" updated="2 de novembro de 2026">
      <p>
        Estes termos regulam o uso da plataforma Barber Voice por estabelecimentos (barbearias, salões e
        afins) e suas equipes. Ao criar uma conta, você declara ter poderes para representar o estabelecimento
        cadastrado.
      </p>
      <h2>1. O serviço</h2>
      <p>
        O Barber Voice oferece agenda online, cadastro de clientes e uma recepcionista virtual baseada em
        inteligência artificial que pode atender ligações e mensagens em nome do estabelecimento, conforme as
        integrações contratadas.
      </p>
      <h2>2. Responsabilidades do estabelecimento</h2>
      <ul>
        <li>
          Manter serviços, preços, horários e profissionais corretos e atualizados — a recepcionista usa
          apenas essas informações.
        </li>
        <li>Obter as bases legais e consentimentos necessários para comunicar-se com seus clientes.</li>
        <li>Usar canais de comunicação de acordo com as políticas das operadoras e da Meta (WhatsApp).</li>
        <li>Manter suas credenciais em sigilo e cadastrar a equipe com o nível de acesso adequado.</li>
      </ul>
      <h2>3. Limites da inteligência artificial</h2>
      <p>
        A recepcionista não inventa horários, preços ou serviços e só confirma agendamentos gravados na
        agenda. Ainda assim, sistemas de IA podem cometer erros de compreensão; por isso há transferência para
        atendimento humano, registro das conversas e revisão pelo painel.
      </p>
      <h2>4. Planos, franquias e cobrança</h2>
      <p>
        Cada plano possui franquias de uso (minutos de ligação, mensagens e processamento de IA). Nenhuma
        cobrança é feita sem autorização clara do contratante. Testes gratuitos têm duração e franquias
        limitadas.
      </p>
      <h2>5. Cancelamento</h2>
      <p>
        O estabelecimento pode cancelar a qualquer momento. Dados são tratados conforme a Política de
        Privacidade.
      </p>
      <h2>6. Contato</h2>
      <p>Dúvidas sobre estes termos: suporte pelo painel ou pelo e-mail informado na contratação.</p>
    </LegalPage>
  );
}
