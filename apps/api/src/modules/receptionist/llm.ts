import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../../config';

export type LlmMessage = Anthropic.Beta.BetaMessageParam;
export type LlmTool = Anthropic.Beta.BetaTool;
export type LlmResponse = Anthropic.Beta.BetaMessage;

export interface LlmRequest {
  /** Instruções compiladas e CONGELADAS no início da conversa (cacheáveis). */
  system: string;
  tools: LlmTool[];
  /** Histórico somente-acréscimo (blocos de raciocínio e ferramentas preservados como vieram). */
  messages: LlmMessage[];
}

/** Cliente de modelo de linguagem. Implementado pela Anthropic em produção e por roteiros nos testes. */
export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Falha transitória ou de configuração do provedor (a conversa recebe uma resposta segura). */
export class LlmUnavailableError extends Error {
  constructor(
    message: string,
    readonly kind: 'TRANSIENT' | 'CONFIGURATION' | 'REQUEST',
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class AnthropicLlmClient implements LlmClient {
  readonly provider = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly effort: 'low' | 'medium' | 'high',
  ) {
    // chave explícita: o servidor nunca usa credenciais de perfis locais por engano
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    try {
      return await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16_000,
        betas: ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'],
        // recusa de segurança → a própria API tenta o modelo de contingência na mesma chamada
        fallbacks: 'default',
        // raciocínio adaptativo; se o histórico divergir (ex.: nova versão das ferramentas),
        // descarta o raciocínio antigo em vez de falhar a conversa
        thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
        output_config: { effort: this.effort },
        // cache automático do prefixo (ferramentas + instruções congeladas + histórico)
        cache_control: { type: 'ephemeral' },
        system: [{ type: 'text', text: req.system }],
        tools: req.tools,
        messages: req.messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new LlmUnavailableError(
          'Credencial do provedor de IA inválida ou sem permissão.',
          'CONFIGURATION',
          {
            cause: err,
          },
        );
      }
      if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
        throw new LlmUnavailableError('Requisição recusada pelo provedor de IA.', 'REQUEST', { cause: err });
      }
      if (
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError ||
        err instanceof Anthropic.APIError
      ) {
        throw new LlmUnavailableError('Provedor de IA indisponível no momento.', 'TRANSIENT', { cause: err });
      }
      throw err;
    }
  }
}

/** Sem `ANTHROPIC_API_KEY` configurada, a recepcionista fica "não integrada" — nada é simulado. */
export function createLlmClient(config: Config): LlmClient | null {
  const key = config.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return new AnthropicLlmClient(key, config.ANTHROPIC_MODEL, config.ANTHROPIC_EFFORT);
}
