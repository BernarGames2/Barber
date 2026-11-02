import { describe, expect, it } from 'vitest';
import { containsInterval, intersect, normalize, subtract, totalDuration } from '../src/time/interval';
import {
  addDays,
  eachDate,
  formatLongDatePt,
  instantToLocal,
  isValidLocalDate,
  isValidTimeZone,
  localToInstant,
  minutesToTime,
  timeToMinutes,
  todayInZone,
  weekdayOf,
} from '../src/time/zone';

const I = (start: number, end: number) => ({ start, end });

describe('intervalos', () => {
  it('normalize ordena, une sobrepostos/adjacentes e remove vazios', () => {
    expect(normalize([I(5, 7), I(1, 3), I(3, 4), I(6, 9), I(10, 10)])).toEqual([I(1, 4), I(5, 9)]);
  });

  it('intersect', () => {
    expect(intersect([I(0, 10), I(20, 30)], [I(5, 25)])).toEqual([I(5, 10), I(20, 25)]);
    expect(intersect([I(0, 10)], [I(10, 20)])).toEqual([]);
  });

  it('subtract', () => {
    expect(subtract([I(0, 100)], [I(10, 20), I(30, 40)])).toEqual([I(0, 10), I(20, 30), I(40, 100)]);
    expect(subtract([I(0, 10)], [I(-5, 15)])).toEqual([]);
    expect(subtract([I(0, 10), I(20, 30)], [I(5, 25)])).toEqual([I(0, 5), I(25, 30)]);
    expect(subtract([I(0, 10)], [])).toEqual([I(0, 10)]);
  });

  it('containsInterval e totalDuration', () => {
    expect(containsInterval([I(0, 10)], I(2, 10))).toBe(true);
    expect(containsInterval([I(0, 5), I(5, 10)], I(2, 8))).toBe(true); // adjacentes unidos
    expect(containsInterval([I(0, 5), I(6, 10)], I(2, 8))).toBe(false);
    expect(totalDuration([I(0, 5), I(3, 10), I(20, 25)])).toBe(15);
  });
});

describe('fuso horário', () => {
  it('converte hora local de São Paulo (UTC-3) para UTC', () => {
    const ms = localToInstant('2026-11-02', '10:00', 'America/Sao_Paulo');
    expect(new Date(ms).toISOString()).toBe('2026-11-02T13:00:00.000Z');
    expect(instantToLocal(ms, 'America/Sao_Paulo')).toMatchObject({ date: '2026-11-02', time: '10:00', weekday: 1 });
  });

  it('respeita fusos diferentes do Brasil', () => {
    const manaus = localToInstant('2026-11-02', '10:00', 'America/Manaus');
    expect(new Date(manaus).toISOString()).toBe('2026-11-02T14:00:00.000Z');
    const noronha = localToInstant('2026-11-02', '10:00', 'America/Noronha');
    expect(new Date(noronha).toISOString()).toBe('2026-11-02T12:00:00.000Z');
  });

  it('a data local depende do fuso perto da meia-noite', () => {
    const ms = Date.parse('2026-11-03T02:30:00Z'); // 23:30 de 02/11 em SP
    expect(todayInZone('America/Sao_Paulo', ms)).toBe('2026-11-02');
    expect(todayInZone('UTC', ms)).toBe('2026-11-03');
  });

  it('utilitários de data', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekdayOf('2026-11-08')).toBe(7);
    expect(eachDate('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(timeToMinutes('09:30:00')).toBe(570);
    expect(minutesToTime(570)).toBe('09:30');
    expect(() => timeToMinutes('24:00')).toThrow();
    expect(formatLongDatePt('2026-11-06')).toBe('sexta-feira, 6 de novembro');
  });
});
