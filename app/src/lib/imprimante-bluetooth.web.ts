import type { ImprimanteBluetooth } from './imprimante-bluetooth';

/** Sur ordinateur, les reçus passent par l'imprimante du système (`impression.ts`). */
export const bluetoothDisponible = false;

export type { ImprimanteBluetooth };

const indisponible = () =>
  Promise.reject(new Error('Imprimante Bluetooth disponible sur l’application Android.'));

export function chercherImprimantes(
  _surTrouvee: (imprimante: ImprimanteBluetooth) => void,
  _surErreur: (message: string) => void,
): Promise<() => void> {
  return indisponible();
}

export function imprimerBluetooth(_imprimanteId: string, _octets: Uint8Array): Promise<void> {
  return indisponible();
}
