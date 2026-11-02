'use client';

import { AudioLines, Languages, MessageSquareQuote, Mic2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/shell/app-shell';
import { Badge, Card, CardBody, CardHeader, Notice } from '@/components/ui/card';

const LIBRARY = [
  { group: 'Barbearias', items: ['Rocker', 'Clássico', 'Urban', 'Premium', 'Esportivo', 'Retrô'] },
  { group: 'Salões de beleza', items: ['Sofia', 'Bia', 'Helena', 'Fashion', 'Natural'] },
];

export default function VoiceStudioPage() {
  return (
    <>
      <PageHeader
        title="Voice Studio"
        description="A identidade da sua recepcionista: personagem, voz e linguagem."
      />
      <Notice tone="brass" title="Em desenvolvimento — Fase 3 do roadmap" className="mb-6">
        O Voice Studio ainda não está disponível nesta versão. A recepcionista de IA permanece desativada até
        que a personagem e os canais estejam configurados e testados. Nada nesta página simula funcionamento.
      </Notice>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Biblioteca de personagens"
            description="Personalidades prontas, ampliáveis sem reconstruir o sistema."
          />
          <CardBody className="flex flex-col gap-5">
            {LIBRARY.map((g) => (
              <div key={g.group}>
                <p className="mb-2 text-xs font-medium tracking-wide text-ink-400 uppercase">{g.group}</p>
                <div className="flex flex-wrap gap-2">
                  {g.items.map((i) => (
                    <Badge key={i} tone="neutral" className="h-7 px-3 text-[13px]">
                      {i}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[13px] text-ink-500">
              Também será possível criar uma personagem exclusiva do seu estabelecimento.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="O que você vai controlar" />
          <CardBody>
            <ul className="space-y-4 text-sm">
              {[
                {
                  icon: <Languages className="size-4" />,
                  t: 'Linguagem formal, semiformal ou informal — independente da personagem',
                },
                {
                  icon: <SlidersHorizontal className="size-4" />,
                  t: 'Intensidade de gírias, entusiasmo, descontração e uso do nome do cliente',
                },
                {
                  icon: <MessageSquareQuote className="size-4" />,
                  t: 'Saudação, despedida, expressões características e vocabulário',
                },
                {
                  icon: <Mic2 className="size-4" />,
                  t: 'Vozes femininas e masculinas realmente distintas, com teste antes de escolher',
                },
                { icon: <Sparkles className="size-4" />, t: 'Emojis só no WhatsApp e só se você ativar' },
                {
                  icon: <AudioLines className="size-4" />,
                  t: 'Simulador para conversar com a personagem antes de ativar',
                },
              ].map((x) => (
                <li key={x.t} className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-brass-300">
                    {x.icon}
                  </span>
                  <span className="text-ink-700">{x.t}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
