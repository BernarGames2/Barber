import { z } from 'zod';
import { emailSchema, nameSchema } from './common';

export const PASSWORD_MIN = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `A senha deve ter pelo menos ${PASSWORD_MIN} caracteres`)
  .max(128, 'A senha deve ter no máximo 128 caracteres')
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Use letras e números na senha');

export const signupSchema = z.object({
  name: nameSchema('Nome'),
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'É preciso aceitar os termos de uso e a política de privacidade' }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha').max(128),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export type MemberRole = 'OWNER' | 'MANAGER' | 'STAFF';

export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: MemberRole;
  tenantStatus: 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  onboardingCompleted: boolean;
  isDemo: boolean;
}

export interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    isPlatformAdmin: boolean;
  };
  memberships: MembershipSummary[];
}
