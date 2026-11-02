'use client';

import { ROLE_LABELS } from '@barber-voice/contracts';
import {
  AudioLines,
  CalendarDays,
  ChevronsUpDown,
  LayoutGrid,
  LogOut,
  Menu,
  MessagesSquare,
  Scissors,
  Settings,
  UserRound,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DropdownMenu, Dialog as RDialog } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { useSession } from '@/lib/session';

const NAV = [
  { href: '/painel', label: 'Início', icon: LayoutGrid, exact: true },
  { href: '/painel/agenda', label: 'Agenda', icon: CalendarDays },
  { href: '/painel/clientes', label: 'Clientes', icon: Users },
  { href: '/painel/servicos', label: 'Serviços', icon: Scissors },
  { href: '/painel/profissionais', label: 'Profissionais', icon: UserRound },
  { href: '/painel/voice-studio', label: 'Voice Studio', icon: AudioLines },
  { href: '/painel/conversas', label: 'Conversas', icon: MessagesSquare, soon: 'Fase 4' },
  { href: '/painel/configuracoes', label: 'Configurações', icon: Settings },
] as const;

function useActive() {
  const pathname = usePathname();
  return (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function TenantSwitcher() {
  const { me, membership, setTenantId } = useSession();
  const many = me.memberships.length > 1;
  const content = (
    <div className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brass-500/15 text-[13px] font-semibold text-brass-300 ring-1 ring-brass-500/25">
        {initials(membership.tenantName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-paper">{membership.tenantName}</span>
        <span className="block text-xs text-ink-400">{ROLE_LABELS[membership.role]}</span>
      </span>
      {many ? <ChevronsUpDown className="size-4 text-ink-400" /> : null}
    </div>
  );
  if (!many) return content;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="w-full focus:outline-none">{content}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={6}
          align="start"
          className="z-50 min-w-60 rounded-xl bg-white p-1.5 shadow-pop animate-fade-in"
        >
          <DropdownMenu.Label className="px-2.5 py-1.5 text-xs text-ink-400">
            Seus estabelecimentos
          </DropdownMenu.Label>
          {me.memberships.map((m) => (
            <DropdownMenu.Item
              key={m.tenantId}
              onSelect={() => setTenantId(m.tenantId)}
              className={cn(
                'cursor-pointer rounded-lg px-2.5 py-2 text-sm text-ink-800 outline-none data-[highlighted]:bg-ink-50',
                m.tenantId === membership.tenantId && 'font-medium',
              )}
            >
              {m.tenantName}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-ink-100" />
          <DropdownMenu.Item
            asChild
            className="cursor-pointer rounded-lg px-2.5 py-2 text-sm text-ink-600 outline-none data-[highlighted]:bg-ink-50"
          >
            <Link href="/onboarding?novo=1">+ Novo estabelecimento</Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const isActive = useActive();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Navegação principal">
      {NAV.map((item) => {
        const active = isActive(item.href, 'exact' in item ? item.exact : false);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors',
              active ? 'bg-white/[0.07] text-paper' : 'text-ink-300 hover:bg-white/[0.04] hover:text-paper',
            )}
          >
            {active ? (
              <span className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-brass-400" />
            ) : null}
            <Icon
              className={cn(
                'size-[18px]',
                active ? 'text-brass-300' : 'text-ink-400 group-hover:text-ink-200',
              )}
            />
            <span className="flex-1">{item.label}</span>
            {'soon' in item ? (
              <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink-400 uppercase">
                {item.soon}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function UserFooter() {
  const { me, logout } = useSession();
  return (
    <div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
      <span className="flex size-8 items-center justify-center rounded-full bg-ink-700 text-xs font-semibold text-ink-200">
        {initials(me.user.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink-200">{me.user.name}</span>
        <span className="block truncate text-xs text-ink-500">{me.user.email}</span>
      </span>
      <button
        onClick={() => void logout()}
        className="rounded-lg p-2 text-ink-400 transition-colors hover:bg-white/5 hover:text-paper"
        aria-label="Sair"
        title="Sair"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <Link href="/painel" className="px-2.5" onClick={onNavigate}>
        <Logo tone="light" />
      </Link>
      <TenantSwitcher />
      <div className="flex-1 overflow-y-auto">
        <NavList onNavigate={onNavigate} />
      </div>
      <UserFooter />
    </div>
  );
}

function MobileTabBar({ onMore }: { onMore: () => void }) {
  const isActive = useActive();
  const items = [NAV[0], NAV[1], NAV[2]];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-ink-150 bg-white/95 backdrop-blur lg:hidden [padding-bottom:env(safe-area-inset-bottom)]"
      aria-label="Navegação rápida"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href, 'exact' in item ? item.exact : false);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium',
              active ? 'text-ink-900' : 'text-ink-400',
            )}
          >
            <Icon className={cn('size-5', active && 'text-brass-600')} />
            {item.label}
          </Link>
        );
      })}
      <button
        onClick={onMore}
        className="flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium text-ink-400"
      >
        <Menu className="size-5" />
        Mais
      </button>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const { membership, tenant } = useSession();
  const needsSetup = !membership.onboardingCompleted && !tenant?.onboardingCompletedAt;

  return (
    <div className="min-h-dvh lg:pl-[264px]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] bg-ink-900 lg:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-ink-150 bg-paper/90 px-4 backdrop-blur lg:hidden">
        <Link href="/painel">
          <Logo />
        </Link>
        <button
          onClick={() => setDrawer(true)}
          className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>
      </header>

      <RDialog.Root open={drawer} onOpenChange={setDrawer}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-50 bg-ink-950/50 animate-fade-in lg:hidden" />
          <RDialog.Content className="fixed inset-y-0 left-0 z-50 w-[84%] max-w-[300px] bg-ink-900 shadow-pop animate-rise lg:hidden">
            <RDialog.Title className="sr-only">Menu</RDialog.Title>
            <RDialog.Description className="sr-only">Navegação do painel</RDialog.Description>
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>

      {needsSetup ? (
        <div className="border-b border-brass-200 bg-brass-50 px-4 py-2.5 text-center text-[13px] text-brass-800 sm:px-8">
          A configuração do estabelecimento ainda não foi concluída.{' '}
          <Link href="/onboarding" className="font-semibold underline underline-offset-2">
            Continuar configuração
          </Link>
        </div>
      ) : null}
      {tenant?.isDemo ? (
        <div className="bg-ink-900 px-4 py-2 text-center text-[13px] text-brass-200">
          Estabelecimento de demonstração — os dados exibidos são fictícios.
        </div>
      ) : null}

      <main className="mx-auto max-w-[1280px] px-4 pt-6 pb-28 sm:px-8 lg:pt-8 lg:pb-12">{children}</main>
      <MobileTabBar onMore={() => setDrawer(true)} />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-[34px] leading-tight tracking-tight text-ink-900 sm:text-[40px]">
          {title}
        </h1>
        {description ? <p className="mt-1 text-[15px] text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
