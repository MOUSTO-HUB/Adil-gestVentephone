import { paquets, versBase64 } from '@gestvente/commun';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, type Characteristic, State } from 'react-native-ble-plx';

/**
 * Imprimante thermique Bluetooth (BLE, commandes ESC/POS). Nécessite une version
 * installée de l'application (pas Expo Go) ; sur ordinateur, voir `imprimante-bluetooth.web.ts`.
 */

export const bluetoothDisponible = true;

export interface ImprimanteBluetooth {
  id: string;
  nom: string;
}

let gestionnaire: BleManager | null = null;
const ble = () => (gestionnaire ??= new BleManager());

async function autoriser(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const permissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const reponses = await PermissionsAndroid.requestMultiple(permissions);
  if (Object.values(reponses).some((r) => r !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error('Autorisez l’accès au Bluetooth pour utiliser l’imprimante.');
  }
}

/** Attend que le Bluetooth soit allumé (l'état est « inconnu » juste après le démarrage). */
function bluetoothAllume(): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    const minuterie = setTimeout(() => {
      abonnement.remove();
      rejeter(new Error('Activez le Bluetooth du téléphone.'));
    }, 3000);
    const abonnement = ble().onStateChange((etat) => {
      if (etat !== State.PoweredOn) return;
      clearTimeout(minuterie);
      abonnement.remove();
      resoudre();
    }, true);
  });
}

/** Recherche les imprimantes à proximité ; renvoie la fonction qui arrête la recherche. */
export async function chercherImprimantes(
  surTrouvee: (imprimante: ImprimanteBluetooth) => void,
  surErreur: (message: string) => void,
): Promise<() => void> {
  await autoriser();
  await bluetoothAllume();
  const vues = new Set<string>();
  await ble().startDeviceScan(null, null, (erreur, appareil) => {
    if (erreur) {
      surErreur('Recherche Bluetooth interrompue.');
      return;
    }
    const nom = appareil?.name ?? appareil?.localName;
    if (!appareil || !nom || vues.has(appareil.id)) return;
    vues.add(appareil.id);
    surTrouvee({ id: appareil.id, nom });
  });
  const arret = setTimeout(() => void ble().stopDeviceScan(), 15_000);
  return () => {
    clearTimeout(arret);
    void ble().stopDeviceScan();
  };
}

/** Première caractéristique où l'on peut écrire (le service d'impression varie selon la marque). */
async function caracteristiqueEcriture(id: string): Promise<Characteristic> {
  for (const service of await ble().servicesForDevice(id)) {
    const caracteristiques = await ble().characteristicsForDevice(id, service.uuid);
    const trouvee =
      caracteristiques.find((c) => c.isWritableWithResponse) ??
      caracteristiques.find((c) => c.isWritableWithoutResponse);
    if (trouvee) return trouvee;
  }
  throw new Error('Cet appareil n’accepte pas l’impression : choisissez une imprimante.');
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Envoie les commandes ESC/POS à l'imprimante, par paquets adaptés au MTU. */
export async function imprimerBluetooth(imprimanteId: string, octets: Uint8Array): Promise<void> {
  await autoriser();
  await bluetoothAllume();
  let appareil;
  try {
    appareil = await ble().connectToDevice(imprimanteId, { timeout: 10_000 });
  } catch {
    throw new Error('Imprimante introuvable : allumez-la et rapprochez-la du téléphone.');
  }
  try {
    if (Platform.OS === 'android') appareil = await appareil.requestMTU(185);
    await appareil.discoverAllServicesAndCharacteristics();
    const c = await caracteristiqueEcriture(appareil.id);
    const taille = Math.max(20, Math.min(180, appareil.mtu - 3));
    for (const p of paquets(octets, taille)) {
      const valeur = versBase64(p);
      if (c.isWritableWithResponse) {
        await ble().writeCharacteristicWithResponseForDevice(
          appareil.id,
          c.serviceUUID,
          c.uuid,
          valeur,
        );
      } else {
        await ble().writeCharacteristicWithoutResponseForDevice(
          appareil.id,
          c.serviceUUID,
          c.uuid,
          valeur,
        );
        // Sans accusé de réception : laisser l'imprimante vider sa mémoire tampon.
        await pause(20);
      }
    }
  } finally {
    await ble()
      .cancelDeviceConnection(imprimanteId)
      .catch(() => undefined);
  }
}
