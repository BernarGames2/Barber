import { resetTestDatabase } from '@barber-voice/db/testing';

export default async function setup() {
  await resetTestDatabase();
}
