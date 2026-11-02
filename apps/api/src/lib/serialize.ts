import { normalizeTime } from '@barber-voice/core';

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export const isoRequired = (d: Date): string => d.toISOString();

/** 'HH:mm:ss' do PostgreSQL → 'HH:mm'. */
export const hhmm = (t: string): string => normalizeTime(t);

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}
