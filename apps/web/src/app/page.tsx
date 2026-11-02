import {
  ArrowRight,
  CalendarCheck2,
  Check,
  MessageCircle,
  PhoneCall,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { Logo, LogoMark } from '@/components/brand/logo';
import { VoiceBars } from '@/components/ui/spinner';

const personas = [
  { name: 'Rocker', for: 'Barbearias rock', tone: 'Energia e atitude' },
  { name: 'Clássico', for: 'Barbearias tradicionais', tone: 'Educado e objetivo' },
  { name: 'Urban', for: 'Streetwear', tone: 'Jovem e dinâmico' },
  { name: 'Premium', for: 'Alto padrão', tone: 'Concierge refinado' },
  { name: 'Esportivo', for: 'Ligadas ao esporte', tone: 'Descontraído' },
  { name: 'Retrô', for: 'Old school', tone: 'Acolhedor' },
  { name: 'Sofia', for: 'Salões premium', tone: 'Sofisticada' },
  { name: 'Bia', for: 'Salões modernos', tone: 'Alegre e espontânea' },
  { name: 'Helena', for: 'Salões familiares', tone: 'Madura e tranquila' },
  { name: 'Fashion', for: 'Moda e tendências', tone: 'Antenada' },
  { name: 'Natural', for: 'Cuidados naturais', tone: 'Calma' },
];

const styles = [
  {
    label: 'Formal',
    text: 'Boa tarde! Temos disponibilidade amanhã às 14h com o João. Posso confirmar para o senhor?',
  },
  { label: 'Semiformal', text: 'Boa tarde! Amanhã às 14h com o João está livre. Quer que eu reserve?' },
  { label: 'Informal', text: 'Fala! Amanhã às 14h com o João tá livre. Bora marcar? 🤘' },
];

const plans = [
  {
    name: 'Start',
    price: 'R$ 149',
    suffix: '/mês',
    items: [
      'Recepcionista de IA com franquia mensal',
      'Agenda inteligente sem conflitos',
      'CRM básico de clientes',
      'Biblioteca de personagens',
    ],
  },
  {
    name: 'Pro',
    price: 'R$ 299',
    suffix: '/mês',
    highlight: true,
    items: [
      'Tudo do Start, com franquias maiores',
      'Voice Studio completo e personagens próprias',
      'Relatórios e Copilot do proprietário',
      'Inteligência comercial e recuperação de clientes',
    ],
  },
  {
    name: 'Enterprise',
    price: 'a partir de R$ 599',
    suffix: '/mês',
    items: [
      'Múltiplas unidades',
      'Gestão ampliada e permissões',
      'Personalização conforme contrato',
      'Suporte dedicado',
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="bg-paper">
      {/* ------------------------------------------------------------ hero */}
      <header className="relative overflow-hidden bg-ink-900 text-paper">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(60rem 30rem at 85% -10%, rgb(184 137 47 / 0.28), transparent 60%), radial-gradient(40rem 24rem at -10% 110%, rgb(184 137 47 / 0.12), transparent 60%)',
          }}
        />
        <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Logo tone="light" />
          <div className="hidden items-center gap-8 text-sm text-ink-300 md:flex">
            <a href="#como-funciona" className="hover:text-paper">
              Como funciona
            </a>
            <a href="#voice-studio" className="hover:text-paper">
              Voice Studio
            </a>
            <a href="#agenda" className="hover:text-paper">
              Agenda
            </a>
            <a href="#planos" className="hover:text-paper">
              Planos
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/entrar"
              className="rounded-xl px-3 py-2 text-sm font-medium text-ink-200 hover:text-paper"
            >
              Entrar
            </Link>
            <Link
              href="/criar-conta"
              className="hidden rounded-xl bg-brass-500 px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-brass-400 sm:inline-flex"
            >
              Criar conta
            </Link>
          </div>
        </nav>

        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 pt-10 pb-20 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:pt-16 lg:pb-28">
          <div className="animate-rise">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-brass-300 ring-1 ring-white/10">
              <VoiceBars className="h-3 text-brass-400" bars={4} />
              Recepcionista de IA para barbearias e salões
            </p>
            <h1 className="mt-6 font-display text-[44px] leading-[1.02] tracking-[-0.01em] text-balance sm:text-6xl lg:text-[68px]">
              A voz da sua barbearia, <em className="text-brass-300">atendendo o dia inteiro.</em>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-300">
              Atende ligações e WhatsApp com a personalidade da sua marca, consulta a agenda real e só
              confirma um horário depois que ele está gravado — sem conflitos, sem inventar preço.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/criar-conta"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brass-500 px-6 text-[15px] font-semibold text-ink-950 hover:bg-brass-400"
              >
                Começar configuração <ArrowRight className="size-4" />
              </Link>
              <a
                href="#founding"
                className="inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px] font-medium text-paper ring-1 ring-white/15 hover:bg-white/5"
              >
                Programa Founding Partners
              </a>
            </div>
          </div>

          {/* exemplo ilustrativo de conversa */}
          <div className="relative animate-rise [animation-delay:120ms]">
            <div className="rounded-3xl bg-ink-850 p-5 shadow-2xl ring-1 ring-white/10 sm:p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-brass-500/15 text-brass-300">
                    <PhoneCall className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">Ligação em andamento</p>
                    <p className="text-xs text-ink-400">Personagem: Rocker · Linguagem semiformal</p>
                  </div>
                </div>
                <VoiceBars className="text-brass-400" />
              </div>
              <div className="mt-6 space-y-3 text-[14px] leading-relaxed">
                <p className="max-w-[85%] rounded-2xl rounded-tl-md bg-white/5 px-4 py-2.5 text-ink-200">
                  Oi, tem horário amanhã depois do almoço pra corte e barba?
                </p>
                <p className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-brass-500/15 px-4 py-2.5 text-paper ring-1 ring-brass-500/25">
                  Tem sim! Amanhã, terça, tenho 13h30 com o João ou 14h com o Pedro. Corte e barba fica R$ 80.
                  Qual prefere?
                </p>
                <p className="max-w-[85%] rounded-2xl rounded-tl-md bg-white/5 px-4 py-2.5 text-ink-200">
                  Com o João.
                </p>
                <p className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-brass-500/15 px-4 py-2.5 text-paper ring-1 ring-brass-500/25">
                  Fechado: terça, 13h30, com o João. Já está confirmado na agenda!
                </p>
              </div>
              <div className="mt-5 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 ring-1 ring-emerald-400/20">
                <CalendarCheck2 className="size-4" /> Confirmação enviada somente após a gravação na agenda
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-ink-500">Exemplo ilustrativo de conversa</p>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ como funciona */}
      <section id="como-funciona" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <p className="text-sm font-medium text-brass-700">Como funciona</p>
        <h2 className="mt-2 max-w-2xl font-display text-4xl leading-tight tracking-tight sm:text-5xl">
          Configure uma vez. Ela atende todos os dias.
        </h2>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {[
            {
              icon: <SlidersHorizontal className="size-5" />,
              title: 'Cadastre o essencial',
              text: 'Serviços, preços, duração, profissionais, jornadas e folgas. Um assistente guia cada passo.',
            },
            {
              icon: <Sparkles className="size-5" />,
              title: 'Escolha a personagem',
              text: 'Uma recepcionista com voz, personalidade e linguagem que combinam com o seu estabelecimento.',
            },
            {
              icon: <MessageCircle className="size-5" />,
              title: 'Ative os canais',
              text: 'Telefone (SIP/VoIP) e WhatsApp Business Platform oficial. Transferência para a equipe quando precisar.',
            },
          ].map((s, i) => (
            <div key={s.title} className="rounded-2xl bg-white p-6 shadow-card">
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl bg-ink-900 text-brass-300">
                  {s.icon}
                </span>
                <span className="font-display text-3xl text-ink-200">0{i + 1}</span>
              </div>
              <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-500">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ voice studio */}
      <section id="voice-studio" className="bg-ink-900 text-paper">
        <div className="mx-auto grid max-w-6xl gap-14 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-brass-300">Voice Studio</p>
            <h2 className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl">
              Personalidade e formalidade <em className="text-brass-300">são escolhas separadas.</em>
            </h2>
            <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-ink-300">
              Sua barbearia de rock pode ter a Rocker falando formalmente. Um salão premium pode preferir a
              Sofia em tom semiformal. Você controla linguagem, gírias, emojis, entusiasmo e voz — de forma
              independente.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {personas.map((p) => (
                <span
                  key={p.name}
                  className="rounded-full bg-white/5 px-3 py-1.5 text-[13px] ring-1 ring-white/10"
                  title={`${p.for} · ${p.tone}`}
                >
                  {p.name}
                </span>
              ))}
              <span className="rounded-full px-3 py-1.5 text-[13px] text-brass-300 ring-1 ring-brass-500/40">
                + crie a sua
              </span>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-xs tracking-wide text-ink-400 uppercase">
              Mesma personagem, três estilos (exemplos)
            </p>
            {styles.map((s) => (
              <div key={s.label} className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
                <p className="text-xs font-medium text-brass-300">{s.label}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-100">“{s.text}”</p>
              </div>
            ))}
            <p className="text-xs text-ink-500">
              No telefone, emojis nunca são falados; no WhatsApp, só se você ativar.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ agenda */}
      <section id="agenda" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-medium text-brass-700">Agenda inteligente</p>
            <h2 className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl">
              Conflito de horário não passa.
            </h2>
            <p className="mt-5 text-[16px] leading-relaxed text-ink-500">
              A IA consulta a agenda real antes de oferecer qualquer horário e só confirma depois da gravação.
              Se dois clientes tentam o mesmo horário ao mesmo tempo, apenas um consegue — garantido pelo
              próprio banco de dados.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              'Jornadas, intervalos e folgas por profissional',
              'Feriados e fechamentos do estabelecimento',
              'Tempo de limpeza entre atendimentos',
              'Encaixes só por decisão da equipe',
              'Fuso horário correto em todo o Brasil',
              'Remarcação sem perder o horário original',
            ].map((t) => (
              <li key={t} className="flex items-start gap-3 rounded-2xl bg-white p-4 text-[15px] shadow-card">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ founding partners */}
      <section id="founding" className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-brass-100 px-6 py-12 sm:px-12">
          <div className="absolute -top-10 -right-6 opacity-[0.12]">
            <LogoMark className="size-64" />
          </div>
          <div className="relative max-w-2xl">
            <p className="text-sm font-semibold text-brass-800">Programa Founding Partners</p>
            <h2 className="mt-2 font-display text-4xl leading-tight tracking-tight text-ink-900 sm:text-5xl">
              30 dias grátis para cinco barbearias selecionadas.
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-700">
              Implantação assistida, treinamento e suporte próximo. Franquias de minutos e mensagens definidas
              desde o início — sem cobrança automática e sem exigência de depoimento.
            </p>
            <Link
              href="/criar-conta?programa=founding"
              className="mt-7 inline-flex h-12 items-center gap-2 rounded-xl bg-ink-900 px-6 text-[15px] font-semibold text-paper hover:bg-ink-800"
            >
              Quero participar <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ planos */}
      <section id="planos" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <p className="text-sm font-medium text-brass-700">Planos</p>
        <h2 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">Simples de entender.</h2>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={
                p.highlight
                  ? 'rounded-3xl bg-ink-900 p-7 text-paper shadow-pop'
                  : 'rounded-3xl bg-white p-7 shadow-card'
              }
            >
              <p
                className={
                  p.highlight ? 'text-sm font-medium text-brass-300' : 'text-sm font-medium text-ink-500'
                }
              >
                {p.name}
              </p>
              <p className="mt-3 flex items-baseline gap-1">
                <span className="font-display text-4xl">{p.price}</span>
                <span className={p.highlight ? 'text-sm text-ink-400' : 'text-sm text-ink-400'}>
                  {p.suffix}
                </span>
              </p>
              <ul className="mt-6 space-y-3 text-[14px]">
                {p.items.map((i) => (
                  <li key={i} className="flex gap-2.5">
                    <Check
                      className={
                        p.highlight
                          ? 'mt-0.5 size-4 shrink-0 text-brass-300'
                          : 'mt-0.5 size-4 shrink-0 text-emerald-600'
                      }
                    />
                    <span className={p.highlight ? 'text-ink-200' : 'text-ink-600'}>{i}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-ink-400">
          Valores de referência para o lançamento. Todos os planos têm franquias de uso de telefonia e IA;
          condições finais são apresentadas antes de qualquer contratação.
        </p>
      </section>

      <footer className="border-t border-ink-150">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Logo />
          <div className="flex flex-wrap gap-6 text-sm text-ink-500">
            <Link href="/termos" className="hover:text-ink-900">
              Termos de uso
            </Link>
            <Link href="/privacidade" className="hover:text-ink-900">
              Privacidade e LGPD
            </Link>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-emerald-600" /> Dados isolados por estabelecimento
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
