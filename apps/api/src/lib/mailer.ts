import type { FastifyBaseLogger } from 'fastify';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Categoria para logs/telemetria, sem conteúdo sensível. */
  kind: 'password_reset' | 'email_verification' | 'invitation' | 'generic';
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Desenvolvimento: escreve o e-mail no log. Em produção NÃO registra o conteúdo
 * (links de redefinição são credenciais) — apenas que o envio foi suprimido.
 * Provedores reais (Resend, SES, SMTP) entram na Fase 6 — ver docs/INTEGRATIONS.md.
 */
export class ConsoleMailer implements Mailer {
  constructor(
    private readonly log: FastifyBaseLogger,
    private readonly production: boolean,
  ) {}

  async send(message: MailMessage): Promise<void> {
    if (this.production) {
      this.log.warn({ kind: message.kind }, 'MAIL_PROVIDER=console em produção: e-mail NÃO enviado');
      return;
    }
    this.log.info(
      { mail: { to: message.to, subject: message.subject, kind: message.kind } },
      `\n----- E-MAIL (dev) -----\nPara: ${message.to}\nAssunto: ${message.subject}\n\n${message.text}\n------------------------`,
    );
  }
}

/** Usado nos testes automatizados para inspecionar mensagens enviadas. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  lastTo(email: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === email);
  }
}
