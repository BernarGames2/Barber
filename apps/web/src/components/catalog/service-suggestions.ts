/**
 * Sugestões de NOMES e DURAÇÕES por categoria, apenas para agilizar o cadastro.
 * Nunca sugerimos preços: o valor é sempre informado pelo estabelecimento.
 */
const BARBER = [
  { name: 'Corte masculino', durationMin: 40 },
  { name: 'Barba', durationMin: 30 },
  { name: 'Corte + barba', durationMin: 60 },
  { name: 'Pezinho / acabamento', durationMin: 15 },
  { name: 'Sobrancelha', durationMin: 15 },
  { name: 'Pigmentação de barba', durationMin: 30 },
  { name: 'Corte infantil', durationMin: 30 },
];

const SALON = [
  { name: 'Corte feminino', durationMin: 60 },
  { name: 'Escova', durationMin: 45 },
  { name: 'Hidratação', durationMin: 45 },
  { name: 'Coloração', durationMin: 120 },
  { name: 'Mechas', durationMin: 180 },
  { name: 'Manicure', durationMin: 45 },
  { name: 'Pedicure', durationMin: 50 },
  { name: 'Design de sobrancelha', durationMin: 30 },
];

export const SERVICE_SUGGESTIONS: Record<string, { name: string; durationMin: number }[]> = {
  BARBERSHOP: BARBER,
  BEAUTY_SALON: SALON,
  UNISEX_SALON: [...BARBER.slice(0, 3), ...SALON.slice(0, 5)],
  HAIR_STUDIO: [...SALON.slice(0, 5)],
  CURLY_HAIR_STUDIO: [
    { name: 'Corte para cachos', durationMin: 90 },
    { name: 'Hidratação para cachos', durationMin: 60 },
    { name: 'Finalização', durationMin: 45 },
    { name: 'Fitagem', durationMin: 60 },
  ],
  BRAIDS_STUDIO: [
    { name: 'Box braids', durationMin: 360 },
    { name: 'Tranças nagô', durationMin: 180 },
    { name: 'Manutenção de tranças', durationMin: 120 },
  ],
  COLOR_STUDIO: [
    { name: 'Coloração', durationMin: 120 },
    { name: 'Mechas / luzes', durationMin: 180 },
    { name: 'Tonalização', durationMin: 60 },
    { name: 'Descoloração', durationMin: 150 },
  ],
  AESTHETICS: [
    { name: 'Limpeza de pele', durationMin: 60 },
    { name: 'Design de sobrancelha', durationMin: 30 },
    { name: 'Depilação', durationMin: 30 },
  ],
  OTHER: BARBER.slice(0, 3),
};
