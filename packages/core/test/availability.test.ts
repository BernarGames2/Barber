import { describe, expect, it } from 'vitest';
import {
  type AvailabilityRequest,
  type ProfessionalScheduleInput,
  type WeeklyInterval,
  computeAvailability,
  groupSlotsByStart,
  pickRepresentativeStarts,
  rankProfessionals,
  validateSlot,
  validateWeeklyIntervals,
} from '../src/scheduling/availability';
import { instantToLocal, localToInstant } from '../src/time/zone';
import { MINUTE_MS, overlaps } from '../src/time/interval';

const TZ = 'America/Sao_Paulo';
const at = (date: string, time: string) => localToInstant(date, time, TZ);
const hhmm = (ms: number) => instantToLocal(ms, TZ).time;
// Segunda-feira, 2 de novembro de 2026, 10:00 em São Paulo
const NOW = at('2026-11-02', '10:00');

const weekdays = (start: string, end: string, days: number[]): WeeklyInterval[] =>
  days.map((d) => ({ weekday: d as WeeklyInterval['weekday'], start, end }));

const BUSINESS: WeeklyInterval[] = [
  ...weekdays('09:00', '19:00', [1, 2, 3, 4, 5]),
  { weekday: 6, start: '09:00', end: '14:00' },
];

function prof(id: string, over: Partial<ProfessionalScheduleInput> = {}): ProfessionalScheduleInput {
  return {
    professionalId: id,
    workingHours: null,
    timeOff: [],
    busy: [],
    durationMin: 30,
    bufferAfterMin: 0,
    ...over,
  };
}

function request(over: Partial<AvailabilityRequest> = {}): AvailabilityRequest {
  return {
    timezone: TZ,
    slotIntervalMin: 30,
    minNoticeMin: 60,
    maxDaysAhead: 30,
    fromDate: '2026-11-02',
    toDate: '2026-11-02',
    businessHours: BUSINESS,
    closures: [],
    professionals: [prof('A')],
    now: NOW,
    ...over,
  };
}

const startsFor = (slots: ReturnType<typeof computeAvailability>, id: string, date?: string) =>
  slots
    .filter((s) => s.professionalId === id && (!date || instantToLocal(s.start, TZ).date === date))
    .map((s) => hhmm(s.start));

describe('computeAvailability', () => {
  it('respeita a antecedência mínima e o horário de funcionamento', () => {
    const slots = computeAvailability(request());
    const starts = startsFor(slots, 'A');
    expect(starts[0]).toBe('11:00'); // agora 10:00 + 60 min de antecedência
    expect(starts.at(-1)).toBe('18:30'); // 18:30 + 30 min = 19:00 (fechamento)
    expect(starts).toHaveLength(16);
  });

  it('não oferece horários em domingos (fechado) nem além do limite de dias', () => {
    const sunday = computeAvailability(request({ fromDate: '2026-11-08', toDate: '2026-11-08' }));
    expect(sunday).toHaveLength(0);
    const far = computeAvailability(
      request({ fromDate: '2026-12-20', toDate: '2026-12-31', maxDaysAhead: 30 }),
    );
    expect(far).toHaveLength(0);
  });

  it('ignora datas passadas no pedido', () => {
    const slots = computeAvailability(request({ fromDate: '2026-10-25', toDate: '2026-11-02' }));
    expect(new Set(slots.map((s) => instantToLocal(s.start, TZ).date))).toEqual(new Set(['2026-11-02']));
  });

  it('bloqueia feriados/fechamentos do estabelecimento', () => {
    const slots = computeAvailability(
      request({
        fromDate: '2026-11-03',
        toDate: '2026-11-03',
        closures: [{ start: at('2026-11-03', '00:00'), end: at('2026-11-04', '00:00') }],
      }),
    );
    expect(slots).toHaveLength(0);
  });

  it('evita conflitos com agendamentos existentes e oferece o horário colado ao término', () => {
    const busy = [{ start: at('2026-11-03', '14:00'), end: at('2026-11-03', '14:40') }];
    const slots = computeAvailability(
      request({ fromDate: '2026-11-03', toDate: '2026-11-03', professionals: [prof('A', { busy })] }),
    );
    const starts = startsFor(slots, 'A');
    expect(starts).toContain('13:30');
    expect(starts).not.toContain('14:00');
    expect(starts).not.toContain('14:30');
    expect(starts).toContain('14:40'); // back-to-back
    expect(starts).toContain('15:00');
  });

  it('considera o intervalo de limpeza do NOVO atendimento antes do próximo agendamento', () => {
    const busy = [{ start: at('2026-11-03', '14:00'), end: at('2026-11-03', '15:00') }];
    const slots = computeAvailability(
      request({
        fromDate: '2026-11-03',
        toDate: '2026-11-03',
        professionals: [prof('A', { busy, bufferAfterMin: 10 })],
      }),
    );
    const starts = startsFor(slots, 'A');
    expect(starts).not.toContain('13:30'); // 13:30 + 30 + 10 = 14:10 > 14:00
    expect(starts).toContain('13:00');
    const s = slots.find((x) => hhmm(x.start) === '13:00')!;
    expect(s.blockedUntil - s.end).toBe(10 * MINUTE_MS);
  });

  it('o buffer pode ultrapassar o fechamento (último atendimento termina às 19:00)', () => {
    const slots = computeAvailability(
      request({
        fromDate: '2026-11-03',
        toDate: '2026-11-03',
        professionals: [prof('A', { bufferAfterMin: 15 })],
      }),
    );
    expect(startsFor(slots, 'A').at(-1)).toBe('18:30');
  });

  it('respeita folgas/bloqueios do profissional', () => {
    const timeOff = [{ start: at('2026-11-03', '16:00'), end: at('2026-11-03', '17:00') }];
    const slots = computeAvailability(
      request({ fromDate: '2026-11-03', toDate: '2026-11-03', professionals: [prof('A', { timeOff })] }),
    );
    const starts = startsFor(slots, 'A');
    expect(starts).toContain('15:30');
    expect(starts).not.toContain('16:00');
    expect(starts).not.toContain('16:30');
    expect(starts).toContain('17:00');
  });

  it('usa a jornada própria do profissional, limitada ao horário de funcionamento', () => {
    const B = prof('B', {
      workingHours: [
        ...weekdays('10:00', '12:00', [2, 3, 4, 5, 6]),
        ...weekdays('13:00', '18:00', [2, 3, 4, 5, 6]),
      ],
    });
    const monday = computeAvailability(request({ professionals: [B] }));
    expect(monday).toHaveLength(0); // B não trabalha às segundas

    const tue = startsFor(
      computeAvailability(request({ fromDate: '2026-11-03', toDate: '2026-11-03', professionals: [B] })),
      'B',
    );
    expect(tue).toContain('11:30');
    expect(tue).not.toContain('12:00'); // almoço
    expect(tue).not.toContain('12:30');
    expect(tue[0]).toBe('10:00');
    expect(tue.at(-1)).toBe('17:30');

    // sábado: estabelecimento fecha às 14:00, então a tarde de B é cortada
    const sat = startsFor(
      computeAvailability(request({ fromDate: '2026-11-07', toDate: '2026-11-07', professionals: [B] })),
      'B',
    );
    expect(sat.at(-1)).toBe('13:30');
    expect(sat).not.toContain('14:00');
  });

  it('filtra por janela de horário local (ex.: depois do almoço)', () => {
    const slots = computeAvailability(
      request({ fromDate: '2026-11-03', toDate: '2026-11-03', timeWindow: { from: '13:00', to: '15:00' } }),
    );
    expect(startsFor(slots, 'A')).toEqual(['13:00', '13:30', '14:00', '14:30', '15:00']);
  });

  it('serviços longos só cabem onde há tempo contínuo suficiente', () => {
    const busy = [{ start: at('2026-11-03', '11:00'), end: at('2026-11-03', '12:00') }];
    const slots = computeAvailability(
      request({
        fromDate: '2026-11-03',
        toDate: '2026-11-03',
        professionals: [prof('A', { durationMin: 120, busy })],
      }),
    );
    const starts = startsFor(slots, 'A');
    expect(starts).toContain('09:00');
    expect(starts).not.toContain('09:30'); // 09:30–11:30 colide
    expect(starts).toContain('12:00');
    expect(starts.at(-1)).toBe('17:00');
  });

  it('agrupa e ordena vários profissionais ("qualquer profissional")', () => {
    const slots = computeAvailability(
      request({
        fromDate: '2026-11-03',
        toDate: '2026-11-03',
        professionals: [
          prof('A', { busy: [{ start: at('2026-11-03', '09:00'), end: at('2026-11-03', '19:00') }] }),
          prof('B'),
        ],
      }),
    );
    expect(new Set(slots.map((s) => s.professionalId))).toEqual(new Set(['B']));
    const grouped = groupSlotsByStart(
      computeAvailability(
        request({ fromDate: '2026-11-03', toDate: '2026-11-03', professionals: [prof('A'), prof('B')] }),
      ),
    );
    expect(grouped[0]!.options.map((o) => o.professionalId)).toEqual(['A', 'B']);
    expect(grouped.every((g, i) => i === 0 || g.start > grouped[i - 1]!.start)).toBe(true);
  });

  it('não quebra em dia de transição de horário de verão (fuso com DST)', () => {
    const ny = 'America/New_York';
    const now = localToInstant('2026-03-07', '12:00', ny);
    const slots = computeAvailability({
      timezone: ny,
      slotIntervalMin: 30,
      minNoticeMin: 0,
      maxDaysAhead: 5,
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
      businessHours: [{ weekday: 7, start: '00:00', end: '06:00' }],
      closures: [],
      professionals: [prof('A')],
      now,
    });
    const starts = slots.map((s) => instantToLocal(s.start, ny).time);
    expect(starts).not.toContain('02:00'); // horário inexistente
    expect(new Set(slots.map((s) => s.start)).size).toBe(slots.length);
    // das 00:00 às 06:00 locais há apenas 5 horas reais nesse dia
    expect(slots.at(-1)!.end - slots[0]!.start).toBeLessThanOrEqual(5 * 60 * MINUTE_MS);
  });
});

describe('validateSlot', () => {
  const base = {
    timezone: TZ,
    slotIntervalMin: 30,
    minNoticeMin: 60,
    maxDaysAhead: 30,
    businessHours: BUSINESS,
    closures: [],
    now: NOW,
  };

  it('aceita horário válido, inclusive fora da grade', () => {
    const r = validateSlot({ ...base, professional: prof('A'), start: at('2026-11-03', '10:10') });
    expect(r.ok).toBe(true);
    if (r.ok) expect(hhmm(r.end)).toBe('10:40');
  });

  it.each([
    ['IN_PAST', at('2026-11-02', '09:00')],
    ['TOO_SOON', at('2026-11-02', '10:30')],
    ['TOO_FAR', at('2026-12-15', '10:00')],
    ['CLOSED', at('2026-11-08', '10:00')], // domingo
    ['CLOSED', at('2026-11-03', '18:45')], // termina após o fechamento
    ['CLOSED', at('2026-11-03', '08:30')],
  ] as const)('rejeita %s', (reason, start) => {
    const r = validateSlot({ ...base, professional: prof('A'), start });
    expect(r).toMatchObject({ ok: false, reason });
  });

  it('rejeita horário em fechamento do estabelecimento', () => {
    const r = validateSlot({
      ...base,
      closures: [{ start: at('2026-11-03', '00:00'), end: at('2026-11-04', '00:00') }],
      professional: prof('A'),
      start: at('2026-11-03', '10:00'),
    });
    expect(r).toMatchObject({ ok: false, reason: 'CLOSED' });
  });

  it('rejeita fora da jornada do profissional, folga e conflito', () => {
    const B = prof('B', { workingHours: weekdays('10:00', '12:00', [2]) });
    expect(validateSlot({ ...base, professional: B, start: at('2026-11-03', '12:15') })).toMatchObject({
      reason: 'OUTSIDE_WORKING_HOURS',
    });
    const off = prof('A', {
      timeOff: [{ start: at('2026-11-03', '15:00'), end: at('2026-11-03', '16:00') }],
    });
    expect(validateSlot({ ...base, professional: off, start: at('2026-11-03', '14:45') })).toMatchObject({
      reason: 'TIME_OFF',
    });
    const busy = prof('A', { busy: [{ start: at('2026-11-03', '15:00'), end: at('2026-11-03', '15:40') }] });
    expect(validateSlot({ ...base, professional: busy, start: at('2026-11-03', '15:20') })).toMatchObject({
      reason: 'CONFLICT',
    });
    // buffer do novo atendimento invade o próximo
    const withBuffer = prof('A', {
      bufferAfterMin: 10,
      busy: [{ start: at('2026-11-03', '15:00'), end: at('2026-11-03', '15:30') }],
    });
    expect(
      validateSlot({ ...base, professional: withBuffer, start: at('2026-11-03', '14:30') }),
    ).toMatchObject({
      reason: 'CONFLICT',
    });
  });

  it('encaixe deliberado (ignoreConflicts) só ignora conflito, não o horário', () => {
    const busy = prof('A', { busy: [{ start: at('2026-11-03', '15:00'), end: at('2026-11-03', '15:40') }] });
    expect(
      validateSlot({ ...base, professional: busy, start: at('2026-11-03', '15:20'), ignoreConflicts: true })
        .ok,
    ).toBe(true);
    expect(
      validateSlot({ ...base, professional: busy, start: at('2026-11-08', '15:20'), ignoreConflicts: true }),
    ).toMatchObject({ reason: 'CLOSED' });
  });

  it('não permite atravessar a meia-noite mesmo ignorando o horário de funcionamento', () => {
    const r = validateSlot({
      ...base,
      professional: prof('A', { durationMin: 60 }),
      start: at('2026-11-03', '23:30'),
      ignoreWorkingHours: true,
    });
    expect(r).toMatchObject({ reason: 'CROSSES_MIDNIGHT' });
  });

  it('rejeita duração inválida', () => {
    expect(
      validateSlot({
        ...base,
        professional: prof('A', { durationMin: 0 }),
        start: at('2026-11-03', '10:00'),
      }),
    ).toMatchObject({
      reason: 'INVALID_DURATION',
    });
  });
});

/** Gerador pseudoaleatório determinístico (mulberry32) para testes reprodutíveis. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('propriedades do motor (fuzz com 300 cenários aleatórios)', () => {
  it('computeAvailability ≡ conjunto de horários da grade aprovados por validateSlot, sem sobreposições', () => {
    const rand = rng(20261102);
    const date = '2026-11-04';
    for (let scenario = 0; scenario < 300; scenario++) {
      const durationMin = [15, 30, 40, 45, 60, 90][Math.floor(rand() * 6)]!;
      const bufferAfterMin = [0, 0, 5, 10, 15][Math.floor(rand() * 5)]!;
      const slotIntervalMin = [15, 30][Math.floor(rand() * 2)]!;
      const busy: { start: number; end: number }[] = [];
      for (let k = 0; k < Math.floor(rand() * 6); k++) {
        const startMin = 9 * 60 + Math.floor(rand() * 40) * 15 + (rand() < 0.3 ? 5 : 0);
        const len = 15 + Math.floor(rand() * 6) * 10;
        const s = at(
          date,
          `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`,
        );
        busy.push({ start: s, end: s + len * MINUTE_MS });
      }
      const timeOff = rand() < 0.4 ? [{ start: at(date, '12:00'), end: at(date, '13:00') }] : [];
      const professional = prof('P', { durationMin, bufferAfterMin, busy, timeOff });
      const req = request({
        fromDate: date,
        toDate: date,
        slotIntervalMin,
        professionals: [professional],
        includeBackToBack: false,
      });

      const computed = new Set(computeAvailability(req).map((s) => s.start));
      const brute = new Set<number>();
      for (let m = 0; m < 24 * 60; m += slotIntervalMin) {
        const start = at(
          date,
          `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
        );
        const v = validateSlot({ ...req, professional, start });
        if (v.ok) brute.add(start);
      }
      expect([...computed].sort()).toEqual([...brute].sort());

      // com back-to-back ligado, todo horário oferecido continua válido e livre
      for (const s of computeAvailability({ ...req, includeBackToBack: true })) {
        expect(validateSlot({ ...req, professional, start: s.start }).ok).toBe(true);
        expect(busy.some((b) => overlaps(b, { start: s.start, end: s.blockedUntil }))).toBe(false);
      }
    }
  }, 30_000);

  it('desempenho: 7 dias × 10 profissionais em menos de 50 ms', () => {
    const professionals = Array.from({ length: 10 }, (_, i) =>
      prof(`P${i}`, {
        busy: [
          { start: at('2026-11-03', '10:00'), end: at('2026-11-03', '11:00') },
          { start: at('2026-11-04', '15:00'), end: at('2026-11-04', '16:30') },
        ],
      }),
    );
    const req = request({ fromDate: '2026-11-02', toDate: '2026-11-08', slotIntervalMin: 15, professionals });
    computeAvailability(req); // aquece caches
    const t0 = performance.now();
    const slots = computeAvailability(req);
    const elapsed = performance.now() - t0;
    expect(slots.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(50);
  });
});

describe('utilitários', () => {
  it('rankProfessionals prioriza o preferido e depois o menos ocupado', () => {
    expect(rankProfessionals(['A', 'B', 'C'], { A: 120, B: 30, C: 30 })).toEqual(['B', 'C', 'A']);
    expect(rankProfessionals(['A', 'B', 'C'], { A: 120, B: 30, C: 30 }, 'A')).toEqual(['A', 'B', 'C']);
  });

  it('pickRepresentativeStarts espalha as opções e mantém o primeiro horário', () => {
    const starts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const picked = pickRepresentativeStarts(starts, 4);
    expect(picked[0]).toBe(1);
    expect(picked).toHaveLength(4);
    expect(picked.at(-1)).toBe(10);
    expect(pickRepresentativeStarts([3, 1, 2], 4)).toEqual([1, 2, 3]);
  });

  it('validateWeeklyIntervals detecta faixas inválidas e sobrepostas', () => {
    expect(validateWeeklyIntervals(weekdays('09:00', '18:00', [1, 2]))).toBeNull();
    expect(validateWeeklyIntervals([{ weekday: 1, start: '10:00', end: '09:00' }])).toMatch(/maior/);
    expect(
      validateWeeklyIntervals([
        { weekday: 1, start: '09:00', end: '12:00' },
        { weekday: 1, start: '11:00', end: '13:00' },
      ]),
    ).toMatch(/sobrepostas/);
    expect(validateWeeklyIntervals([{ weekday: 1, start: '25:00', end: '26:00' }])).toMatch(/inválido/);
  });
});
