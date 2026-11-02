'use client';

import { MessagesSquare } from 'lucide-react';
import { PageHeader } from '@/components/shell/app-shell';
import { Card, EmptyState, Notice } from '@/components/ui/card';

export default function ConversationsPage() {
  return (
    <>
      <PageHeader title="Conversas" description="Caixa de entrada unificada de ligações e WhatsApp." />
      <Notice tone="info" title="Disponível após a integração dos canais — Fase 4" className="mb-6">
        Aqui você vai acompanhar conversas do WhatsApp, histórico de ligações, resumos de atendimento e
        assumir uma conversa quando a recepcionista transferir para a equipe. A integração exige contas no
        WhatsApp Business Platform (Meta) e em um provedor de telefonia — veja a documentação de integrações.
      </Notice>
      <Card>
        <EmptyState
          icon={<MessagesSquare className="size-5" />}
          title="Nenhuma conversa"
          description="Nenhum canal está conectado ainda."
        />
      </Card>
    </>
  );
}
