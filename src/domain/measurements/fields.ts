/** One line of her own list of measurements. The key never changes; the label can. */
export interface MeasurementField {
  id: string;
  key: string;
  label: string;
  sort: number;
  archived: boolean;
}
