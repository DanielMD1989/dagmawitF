import { describe, expect, it } from 'vitest';
import { enoughToSearch, findClients } from './search';

const c = (name: string, phone = '') => ({ name, phone });
const clients = [
  c('Selam Bekele', '0911 22 33 44'),
  c('Hanna Tesfaye', '0922 55 66 77'),
  c('Yonas Alemu'),
  c('Meselech Abebe'),
  c('Sélamawit Girma'),
  c('Tsion Selassie'),
];
const names = (q: string, limit?: number) => findClients(clients, q, limit).map((x) => x.name);

describe('finding a client by what she types (decision 0109)', () => {
  it('waits for two letters, or three digits of a phone', () => {
    expect(enoughToSearch('s')).toBe(false);
    expect(enoughToSearch('se')).toBe(true);
    expect(enoughToSearch('09')).toBe(false);
    expect(enoughToSearch('091')).toBe(true);
    expect(names('s')).toEqual([]);
  });

  it('puts names that start with it first, then a later word, then anywhere; no case or accents', () => {
    expect(names('sel')).toEqual(['Selam Bekele', 'Sélamawit Girma', 'Tsion Selassie', 'Meselech Abebe']);
    expect(names('SELAM')).toEqual(['Selam Bekele', 'Sélamawit Girma']);
  });

  it('finds her by the start of each name typed', () => {
    expect(names('sel bek')).toEqual(['Selam Bekele']);
    expect(names('han tes')).toEqual(['Hanna Tesfaye']);
  });

  it('finds her by her phone, however it was written', () => {
    expect(names('0922')).toEqual(['Hanna Tesfaye']);
    expect(names('556 677')).toEqual(['Hanna Tesfaye']);
  });

  it('shows a few at most', () => {
    expect(names('e', 2)).toEqual([]);
    expect(names('se', 2)).toHaveLength(2);
  });

  it('finds no one for a name she does not have', () => {
    expect(names('Rahel')).toEqual([]);
  });
});
