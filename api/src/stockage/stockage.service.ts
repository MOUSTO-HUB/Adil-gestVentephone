import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type FormatImage = 'jpg' | 'png' | 'webp';

/** Nom de fichier accepté : uuid + extension (rien d'autre ne peut sortir du dossier). */
const NOM_VALIDE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** Reconnaît une image par ses premiers octets (le type annoncé par le client ne suffit pas). */
export function formatImage(octets: Buffer): FormatImage | null {
  if (octets.length > 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff)
    return 'jpg';
  if (octets.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (
    octets.subarray(0, 4).toString('ascii') === 'RIFF' &&
    octets.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export const nomPhotoValide = (nom: string) => NOM_VALIDE.test(nom);

/** Fichiers (photos des produits) dans le dossier STOCKAGE_DIR. */
@Injectable()
export class StockageService {
  private readonly dossier: string;

  constructor(config: ConfigService) {
    const dossier = config.get<string>('STOCKAGE_DIR', 'stockage');
    this.dossier = join(isAbsolute(dossier) ? dossier : resolve(process.cwd(), dossier), 'photos');
  }

  /** Enregistre une image sous un nom aléatoire et renvoie ce nom. */
  async enregistrerPhoto(octets: Buffer, format: FormatImage): Promise<string> {
    await mkdir(this.dossier, { recursive: true });
    const nom = `${randomUUID()}.${format}`;
    await writeFile(join(this.dossier, nom), octets);
    return nom;
  }

  async lirePhoto(nom: string): Promise<Buffer | null> {
    if (!nomPhotoValide(nom)) return null;
    return readFile(join(this.dossier, nom)).catch(() => null);
  }

  async supprimerPhoto(nom: string | null): Promise<void> {
    if (!nom || !nomPhotoValide(nom)) return;
    await rm(join(this.dossier, nom), { force: true });
  }
}
