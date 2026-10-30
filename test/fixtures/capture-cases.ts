/**
 * Cases shared by the screen's rules (src/domain/**) and the database's constraints (test/db/**).
 * Each case is input that has already been tidied (trimmed), and whether it is acceptable.
 * If the two ever disagree, one of the suites fails. (Decision 0007.)
 */

export interface ClientFields {
  name: string;
  phone: string;
  notes: string;
}

export interface ClientCase {
  label: string;
  client: ClientFields;
  valid: boolean;
}

const client = (over: Partial<ClientFields> = {}): ClientFields => ({
  name: 'Selam Tesfaye',
  phone: '',
  notes: '',
  ...over,
});

export const CLIENT_CASES: ClientCase[] = [
  { label: 'a name alone', client: client(), valid: true },
  {
    label: 'an Ethiopian number with a country code',
    client: client({ phone: '+251 91 123 4567' }),
    valid: true,
  },
  { label: 'a number with brackets and dashes', client: client({ phone: '(0911) 12-34-56' }), valid: true },
  { label: 'a name in Amharic script', client: client({ name: 'ሰላም ተስፋዬ' }), valid: true },
  { label: 'a name of 120 characters', client: client({ name: 'a'.repeat(120) }), valid: true },
  { label: 'notes of 2000 characters', client: client({ notes: 'n'.repeat(2000) }), valid: true },
  { label: 'no name', client: client({ name: '' }), valid: false },
  { label: 'a name of 121 characters', client: client({ name: 'a'.repeat(121) }), valid: false },
  { label: 'a phone number with letters', client: client({ phone: '0911 call me' }), valid: false },
  { label: 'a phone number that is too short', client: client({ phone: '123' }), valid: false },
  { label: 'a phone number of 31 characters', client: client({ phone: '1'.repeat(31) }), valid: false },
  { label: 'notes of 2001 characters', client: client({ notes: 'n'.repeat(2001) }), valid: false },
];

export interface MeasuresCase {
  label: string;
  measures: unknown;
  valid: boolean;
}

export const MEASURES_CASES: MeasuresCase[] = [
  { label: 'one measurement', measures: { bust: 92 }, valid: true },
  { label: 'several, with tenths', measures: { bust: 92.5, waist: 70, hip: 98.4 }, valid: true },
  { label: 'the largest allowed value', measures: { bust: 500 }, valid: true },
  { label: 'the smallest allowed value', measures: { bust: 0.1 }, valid: true },
  { label: 'a key with digits and underscores', measures: { back_length_2: 40 }, valid: true },
  { label: 'nothing at all', measures: {}, valid: false },
  { label: 'a list instead of an object', measures: [92], valid: false },
  { label: 'text instead of a number', measures: { bust: '92' }, valid: false },
  { label: 'zero', measures: { bust: 0 }, valid: false },
  { label: 'a negative number', measures: { bust: -5 }, valid: false },
  { label: 'more than 500', measures: { bust: 500.1 }, valid: false },
  { label: 'hundredths', measures: { bust: 92.55 }, valid: false },
  { label: 'a key that starts with a digit', measures: { '2bust': 92 }, valid: false },
  { label: 'a key with capitals', measures: { Bust: 92 }, valid: false },
  { label: 'a key of 41 characters', measures: { ['a'.repeat(41)]: 92 }, valid: false },
];

export interface GarmentFields {
  garmentType: string;
  brief: string;
}

export interface GarmentCase {
  label: string;
  garment: GarmentFields;
  valid: boolean;
}

const garment = (over: Partial<GarmentFields> = {}): GarmentFields => ({
  garmentType: 'Bridal gown',
  brief: '',
  ...over,
});

export const GARMENT_CASES: GarmentCase[] = [
  { label: 'a garment type alone', garment: garment(), valid: true },
  { label: 'a garment with a long brief', garment: garment({ brief: 'b'.repeat(4000) }), valid: true },
  {
    label: 'a garment type of 80 characters',
    garment: garment({ garmentType: 'g'.repeat(80) }),
    valid: true,
  },
  { label: 'a garment type in Amharic script', garment: garment({ garmentType: 'የሠርግ ቀሚስ' }), valid: true },
  { label: 'no garment type', garment: garment({ garmentType: '' }), valid: false },
  {
    label: 'a garment type of 81 characters',
    garment: garment({ garmentType: 'g'.repeat(81) }),
    valid: false,
  },
  { label: 'a brief of 4001 characters', garment: garment({ brief: 'b'.repeat(4001) }), valid: false },
];
