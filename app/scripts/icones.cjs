/**
 * Dessine les icônes de l'application (téléphone ambre sur fond indigo) :
 * site installable (public/icones), favicon, icônes Android et iOS, écran de démarrage.
 * Relancer après un changement de charte : node scripts/icones.cjs
 */
const path = require('node:path');
const Jimp = require(
  require.resolve('jimp-compact', {
    paths: [
      require.resolve('@expo/image-utils', { paths: [require.resolve('expo/package.json')] }),
    ],
  }),
);

const INDIGO = [0x28, 0x35, 0x93];
const AMBRE = [0xf5, 0x9e, 0x0b];
const ECRAN = [0x1a, 0x23, 0x7e];
const BLANC = [0xff, 0xff, 0xff];

/** Distance signée à un rectangle arrondi centré (négative à l'intérieur). */
function rectangleArrondi(x, y, cx, cy, demiLargeur, demiHauteur, rayon) {
  const qx = Math.abs(x - cx) - demiLargeur + rayon;
  const qy = Math.abs(y - cy) - demiHauteur + rayon;
  const dehors = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return dehors + Math.min(Math.max(qx, qy), 0) - rayon;
}

/** Couverture anticrénelée d'un pixel par une forme (distance signée en pixels). */
const couverture = (distance) => Math.min(1, Math.max(0, 0.5 - distance));

/**
 * @param taille côté en pixels
 * @param fond 'arrondi' | 'plein' | 'aucun'
 * @param echelle taille du téléphone par rapport à l'icône
 * @param mono téléphone blanc, sans détails (icône monochrome Android)
 */
async function dessiner(fichier, taille, { fond = 'arrondi', echelle = 1, mono = false } = {}) {
  const image = new Jimp(taille, taille, 0x00000000);
  const t = taille;
  const c = t / 2;
  // Téléphone : 40 % x 64 % de l'icône (à l'échelle 1).
  const hw = 0.2 * t * echelle;
  const hh = 0.32 * t * echelle;
  const corps = mono ? BLANC : AMBRE;
  image.scan(0, 0, t, t, function (x, y, idx) {
    const px = x + 0.5;
    const py = y + 0.5;
    let couleur = [0, 0, 0];
    let alpha = 0;
    const poser = (rgb, a) => {
      if (a <= 0) return;
      couleur = couleur.map((v, i) => v * (1 - a) + rgb[i] * a);
      alpha = alpha + a * (1 - alpha);
    };
    if (fond === 'plein') poser(INDIGO, 1);
    if (fond === 'arrondi') {
      poser(INDIGO, couverture(rectangleArrondi(px, py, c, c, c, c, 0.22 * t)));
    }
    // Corps du téléphone.
    poser(corps, couverture(rectangleArrondi(px, py, c, c, hw, hh, 0.32 * hw)));
    if (!mono) {
      // Écran, haut-parleur et bouton.
      const ecranHaut = c - hh + 0.16 * hh;
      const ecranBas = c + hh - 0.24 * hh;
      poser(
        ECRAN,
        couverture(
          rectangleArrondi(
            px,
            py,
            c,
            (ecranHaut + ecranBas) / 2,
            hw * 0.8,
            (ecranBas - ecranHaut) / 2,
            0.12 * hw,
          ),
        ),
      );
      poser(
        ECRAN,
        couverture(
          rectangleArrondi(px, py, c, c - hh + 0.08 * hh, hw * 0.25, 0.025 * hh, 0.025 * hh),
        ),
      );
      poser(ECRAN, couverture(Math.hypot(px - c, py - (c + hh - 0.12 * hh)) - 0.07 * hh));
      // Trois lignes de ticket sur l'écran (la vente).
      for (const [i, largeur] of [
        [0, 0.5],
        [1, 0.36],
        [2, 0.44],
      ]) {
        const ly = ecranHaut + (ecranBas - ecranHaut) * (0.3 + i * 0.18);
        poser(
          AMBRE,
          couverture(
            rectangleArrondi(
              px,
              py,
              c - hw * 0.55 + hw * largeur,
              ly,
              hw * largeur,
              0.035 * hh,
              0.035 * hh,
            ),
          ),
        );
      }
    }
    image.bitmap.data[idx] = Math.round(alpha ? couleur[0] : 0);
    image.bitmap.data[idx + 1] = Math.round(alpha ? couleur[1] : 0);
    image.bitmap.data[idx + 2] = Math.round(alpha ? couleur[2] : 0);
    image.bitmap.data[idx + 3] = Math.round(alpha * 255);
  });
  await image.writeAsync(fichier);
  console.log(path.relative(process.cwd(), fichier));
}

async function principal() {
  const racine = path.resolve(__dirname, '..');
  const publics = path.join(racine, 'public', 'icones');
  const images = path.join(racine, 'assets', 'images');
  await dessiner(path.join(publics, 'icone-192.png'), 192);
  await dessiner(path.join(publics, 'icone-512.png'), 512);
  // Icône « maskable » : fond plein, téléphone dans la zone sûre (80 %).
  await dessiner(path.join(publics, 'icone-maskable-512.png'), 512, {
    fond: 'plein',
    echelle: 0.75,
  });
  await dessiner(path.join(publics, 'apple-touch-icon.png'), 180, { fond: 'plein', echelle: 0.85 });
  await dessiner(path.join(images, 'favicon.png'), 48);
  await dessiner(path.join(images, 'icon.png'), 1024, { fond: 'plein', echelle: 0.85 });
  // Android : fond et premier plan séparés (zone sûre de 66 %), icône monochrome.
  await dessiner(path.join(images, 'android-icon-background.png'), 1024, {
    fond: 'plein',
    echelle: 0,
  });
  await dessiner(path.join(images, 'android-icon-foreground.png'), 1024, {
    fond: 'aucun',
    echelle: 0.62,
  });
  await dessiner(path.join(images, 'android-icon-monochrome.png'), 1024, {
    fond: 'aucun',
    echelle: 0.62,
    mono: true,
  });
  await dessiner(path.join(images, 'splash-icon.png'), 1024, { fond: 'aucun', echelle: 1 });
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
