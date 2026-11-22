/**
 * Génère docs/Guide-deploiement-o2switch.docx (guide d'installation et d'administration
 * sur l'hébergement o2switch, Offre Cloud).
 *
 * Le module docx n'est pas une dépendance du projet : l'installer dans un dossier à part,
 * puis lancer le script avec NODE_PATH vers ce dossier :
 *   npm install --prefix C:\outils\docx docx@9
 *   $env:NODE_PATH = "C:\outils\docx\node_modules"; node scripts/guide-o2switch.cjs
 * Ouvrir ensuite le fichier dans Word et mettre à jour le sommaire (F9).
 */
const fs = require('fs');
const path = require('path');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} = require('docx');

const SORTIE =
  process.argv[2] ?? path.join(__dirname, '..', 'docs', 'Guide-deploiement-o2switch.docx');
const BLEU = '1F3A93';
const POLICE = 'Calibri';
const MONO = 'Consolas';
const LARGEUR = 9026; // A4, marges de 2,5 cm

// ─── Mise en forme ──────────────────────────────────────────────────────────

/** Texte enrichi : **gras** et `code`. */
function runs(texte, base = {}) {
  return texte
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter(Boolean)
    .map((m) => {
      if (m.startsWith('**')) return new TextRun({ ...base, text: m.slice(2, -2), bold: true });
      if (m.startsWith('`'))
        return new TextRun({
          ...base,
          text: m.slice(1, -1),
          font: MONO,
          size: 19,
          color: '8A1C3B',
        });
      return new TextRun({ ...base, text: m });
    });
}

const P = (texte, options = {}) =>
  new Paragraph({ children: runs(texte), spacing: { after: 120 }, ...options });
const H1 = (texte) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun(texte)],
    pageBreakBefore: true,
  });
const H2 = (texte) =>
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(texte)] });

let numeroEtape = 0;
/** Titre d'étape numéroté en continu dans tout le guide (Étape 1, Étape 2…). */
function ETAPE(texte, duree) {
  numeroEtape += 1;
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [
      new TextRun({ text: `Étape ${numeroEtape} — ` }),
      new TextRun({ text: texte }),
      ...(duree
        ? [
            new TextRun({
              text: `   (≈ ${duree})`,
              italics: true,
              color: '888888',
              bold: false,
              size: 20,
            }),
          ]
        : []),
    ],
  });
}

const puces = (liste) =>
  liste.map(
    (t) =>
      new Paragraph({
        numbering: { reference: 'puces', level: 0 },
        children: runs(t),
        spacing: { after: 60 },
      }),
  );

let instance = 0;
const actions = (liste) => {
  instance += 1;
  return liste.map(
    (t) =>
      new Paragraph({
        numbering: { reference: 'etapes', level: 0, instance },
        children: runs(t),
        spacing: { after: 80 },
      }),
  );
};

/** « Résultat attendu » après une action ou une commande. */
const resultat = (texte) =>
  new Paragraph({
    spacing: { before: 40, after: 160 },
    indent: { left: 200 },
    children: [
      new TextRun({ text: '✔ Résultat attendu : ', bold: true, color: '1E8449' }),
      ...runs(texte),
    ],
  });

/** Bloc de code : une ligne par paragraphe. */
function code(texte, titre) {
  const lignes = texte
    .replace(/^\n/, '')
    .replace(/\n\s*$/, '')
    .split('\n');
  const blocs = lignes.map(
    (ligne, i) =>
      new Paragraph({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F3F5' },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '9AA5C4', space: 6 } },
        spacing: {
          before: i === 0 && !titre ? 80 : 0,
          after: i === lignes.length - 1 ? 160 : 0,
          line: 260,
        },
        indent: { left: 200 },
        children: [new TextRun({ text: ligne || ' ', font: MONO, size: 18 })],
      }),
  );
  if (!titre) return blocs;
  return [
    new Paragraph({
      spacing: { before: 100, after: 0 },
      indent: { left: 200 },
      children: [new TextRun({ text: titre, bold: true, size: 18, color: '5A6478' })],
    }),
    ...blocs,
  ];
}
const ssh = (texte) => code(texte, 'Dans le terminal SSH (serveur o2switch)');
const ps = (texte) => code(texte, 'Dans PowerShell (votre ordinateur Windows)');

/** Encadré coloré. */
function encadre(type, textes) {
  const c = {
    info: { fond: 'E8F1FB', bord: '2F6DB5', titre: 'À savoir' },
    attention: { fond: 'FFF4E0', bord: 'D98A00', titre: 'Attention' },
    danger: { fond: 'FDECEC', bord: 'C0392B', titre: 'Important' },
    ok: { fond: 'E9F7EF', bord: '1E8449', titre: 'Vérifié' },
    verif: { fond: 'EEF0FA', bord: BLEU, titre: 'Point de contrôle' },
  }[type];
  const lignes = Array.isArray(textes) ? textes : [textes];
  const aucun = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return [
    new Table({
      width: { size: LARGEUR, type: WidthType.DXA },
      columnWidths: [LARGEUR],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: LARGEUR, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: c.fond },
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              borders: {
                top: aucun,
                bottom: aucun,
                right: aucun,
                left: { style: BorderStyle.SINGLE, size: 24, color: c.bord },
              },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: c.titre, bold: true, color: c.bord })],
                  spacing: { after: 60 },
                }),
                ...lignes.map(
                  (t, i) =>
                    new Paragraph({
                      children: runs(t),
                      spacing: { after: i === lignes.length - 1 ? 0 : 80 },
                    }),
                ),
              ],
            }),
          ],
        }),
      ],
    }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  ];
}

/** Tableau avec en-tête ; largeurs relatives. */
function tableau(entetes, lignes, proportions) {
  const total = proportions.reduce((a, b) => a + b, 0);
  const largeurs = proportions.map((p) => Math.floor((p / total) * LARGEUR));
  largeurs[largeurs.length - 1] += LARGEUR - largeurs.reduce((a, b) => a + b, 0);
  const bord = { style: BorderStyle.SINGLE, size: 4, color: 'C5CBD8' };
  const cellule = (texte, i, entete) =>
    new TableCell({
      width: { size: largeurs[i], type: WidthType.DXA },
      borders: { top: bord, bottom: bord, left: bord, right: bord },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: entete ? { type: ShadingType.CLEAR, color: 'auto', fill: BLEU } : undefined,
      children: String(texte)
        .split('\n')
        .map(
          (t) =>
            new Paragraph({
              children: entete ? [new TextRun({ text: t, bold: true, color: 'FFFFFF' })] : runs(t),
            }),
        ),
    });
  return [
    new Table({
      width: { size: LARGEUR, type: WidthType.DXA },
      columnWidths: largeurs,
      rows: [
        new TableRow({ tableHeader: true, children: entetes.map((e, i) => cellule(e, i, true)) }),
        ...lignes.map(
          (l) => new TableRow({ cantSplit: true, children: l.map((t, i) => cellule(t, i, false)) }),
        ),
      ],
    }),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
  ];
}

// ─── Contenu ────────────────────────────────────────────────────────────────
const c = [];
const ajouter = (...x) => x.forEach((e) => (Array.isArray(e) ? c.push(...e) : c.push(e)));
const ACTIVER = 'source /home/IDENTIFIANT/nodevenv/gestvente/source/api/24/bin/activate';

// Page de titre
ajouter(
  new Paragraph({ spacing: { before: 2200 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'GestVente Phone', bold: true, size: 56, color: BLEU })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: 'Adil gestion vente phone', size: 30, color: '555555' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLEU, space: 8 } },
    spacing: { after: 400 },
    children: [
      new TextRun({ text: 'Guide de déploiement et d’administration', bold: true, size: 40 }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'Hébergement o2switch — Offre Cloud', size: 28 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [
      new TextRun({
        text: 'Installation pas à pas, mise en service, mises à jour, sauvegardes, dépannage',
        size: 22,
        color: '555555',
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 1400 },
    children: [
      new TextRun({
        text: 'cPanel · Node.js 24 (Passenger) · PostgreSQL · Redis · HTTPS',
        size: 20,
        color: '777777',
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Version 2 — novembre 2026', size: 22 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: 'Ne jamais écrire de mot de passe ni de clé secrète dans ce document.',
        size: 20,
        italics: true,
        color: '777777',
      }),
    ],
  }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({
    spacing: { after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLEU, space: 4 } },
    children: [new TextRun({ text: 'Sommaire', bold: true, size: 34, color: BLEU })],
  }),
  new TableOfContents('Sommaire', { hyperlink: true, headingStyleRange: '1-2' }),
);

// ── 1. Lire ce guide ────────────────────────────────────────────────────────
ajouter(
  H1('1. Comment utiliser ce guide'),
  P(
    'Ce guide installe **GestVente Phone** (Adil gestion vente phone) sur l’hébergement **o2switch, Offre Cloud**, puis explique comment l’administrer. Il est découpé en **étapes numérotées** (Étape 1, Étape 2…) à suivre **dans l’ordre**, sans en sauter : chaque étape s’appuie sur les précédentes.',
  ),
  H2('1.1 Comment se lit une étape'),
  ...tableau(
    ['Élément', 'Signification'],
    [
      ['**Étape N — titre (≈ durée)**', 'Une tâche complète, avec le temps à prévoir.'],
      ['Liste numérotée 1., 2., 3.', 'Les actions à faire, une par une, dans cet ordre.'],
      [
        'Bloc gris « Dans le terminal SSH »',
        'Commandes à taper (ou copier-coller) sur le serveur, connecté en SSH.',
      ],
      ['Bloc gris « Dans PowerShell »', 'Commandes à taper sur votre ordinateur Windows.'],
      [
        '**✔ Résultat attendu**',
        'Ce que vous devez voir. Si ce n’est pas le cas, ne continuez pas : voir le chapitre Dépannage.',
      ],
      [
        'Encadré « Point de contrôle »',
        'Vérification à faire avant de passer à la partie suivante.',
      ],
      ['Encadrés « Attention », « Important »', 'Risque d’erreur ou de perte de données.'],
    ],
    [3.5, 6.5],
  ),
  H2('1.2 Les valeurs à remplacer et où les trouver'),
  P(
    'Les commandes du guide contiennent des valeurs **fictives**, écrites en MAJUSCULES ou sous la forme `mondomaine.com`. Avant de taper une commande, remplacez **chacune** par votre propre valeur. Le tableau ci-dessous indique, pour chaque valeur, **où la trouver exactement** et à quelle étape elle sert. Notez celles qui ne sont pas secrètes dans la fiche du chapitre 3.1 ; les secrets vont dans le gestionnaire de mots de passe.',
  ),
  H2('1.3 Valeurs de l’hébergement (à connaître avant de commencer)'),
  ...tableau(
    ['Dans le guide', 'Ce que c’est', 'Où la trouver exactement', 'Étapes'],
    [
      [
        '`IDENTIFIANT`\n(ex. `adilph`)',
        'Votre identifiant cPanel : c’est aussi votre nom d’utilisateur SSH.',
        '• E-mail de bienvenue d’o2switch, ligne « Identifiant ».\n• cPanel › colonne de droite **Informations générales** › **Nom d’utilisateur actuel**.\n• En SSH : `whoami`',
        '7, 11, 17, 22, 30, 31, 39',
      ],
      [
        '`NOM_DU_SERVEUR`\n(ex. `xxxxx.o2switch.net`)',
        'Nom du serveur o2switch qui héberge votre compte.',
        '• cPanel › **Informations générales** › **Nom du serveur**.\n• E-mail de bienvenue d’o2switch.\n• En SSH : `hostname`',
        '7',
      ],
      [
        '`~`\n(ex. `/home/adilph`)',
        'Votre dossier personnel sur le serveur. `~` est un raccourci : ne le remplacez pas dans les commandes SSH.',
        '• En SSH : `echo $HOME`\n• Il vaut toujours `/home/IDENTIFIANT`. Écrivez le chemin complet là où le guide l’écrit en entier (Cron, `.env`, scripts).',
        '22, 30, 31, 39',
      ],
      [
        '`mondomaine.com`\n(ex. `adilphone.com`)',
        'Votre nom de domaine principal.',
        '• Espace client o2switch › rubrique des domaines.\n• cPanel › **Domaines** : le domaine marqué « principal ».\n• E-mail de bienvenue d’o2switch.\n• En SSH : `uapi DomainInfo list_domains`, ligne `main_domain` (si la commande n’existe pas, utilisez cPanel).',
        '8 à 10, 22, 26 à 29, 31, 39',
      ],
      [
        '`app.mondomaine.com`\n`api.mondomaine.com`',
        'Les deux sous-domaines que vous créez : site et API. Ils se déduisent du domaine.',
        'Vous les créez vous-même à l’étape 9. Remplacez seulement `mondomaine.com` : gardez `app.` et `api.` devant.',
        '9, 10, 17, 22, 25 à 29, 31',
      ],
      [
        'Adresse IP partagée',
        'Adresse du serveur, utile seulement si votre domaine est géré ailleurs que chez o2switch.',
        'cPanel › **Informations générales** › **Adresse IP partagée**.',
        '8',
      ],
      [
        'Votre adresse IP',
        'Adresse Internet de votre connexion, à autoriser pour le SSH.',
        'Proposée automatiquement par l’outil **Autorisation SSH** ; sinon le site mon-ip.io.',
        '5',
      ],
    ],
    [2.3, 2.6, 4.1, 1.5],
  ),
  H2('1.4 Valeurs que vous créez pendant l’installation'),
  ...tableau(
    ['Dans le guide', 'Ce que c’est', 'Où la trouver exactement', 'Étapes'],
    [
      [
        '`IDENTIFIANT_gestvente`',
        'Nom réel de la base **et** de l’utilisateur PostgreSQL : cPanel ajoute votre identifiant et `_` devant le nom choisi.',
        'cPanel › **Bases de données PostgreSQL** › tableau **Bases de données actuelles** (colonnes Base et Utilisateurs). Recopiez-le exactement tel qu’affiché.',
        '11, 12, 22, 30',
      ],
      [
        '`MOT_DE_PASSE_PG`',
        'Mot de passe de l’utilisateur PostgreSQL.',
        'Vous le générez à l’étape 11 (commande `openssl`) et le rangez dans le gestionnaire. Il n’est affiché nulle part ensuite ; s’il est perdu, changez-le dans cPanel (Bases de données PostgreSQL › utilisateur › Changer le mot de passe) puis dans `.env` et `sauvegarde.env`.',
        '11, 12, 22, 30',
      ],
      [
        '`PORT_REDIS`\n(ex. `35481`)',
        'Port de votre instance Redis privée.',
        'cPanel › outil **Redis** › page d’état, ligne **Port** (visible après le démarrage de l’instance).',
        '13, 22',
      ],
      [
        '`MOT_DE_PASSE_REDIS`',
        'Mot de passe de l’instance Redis.',
        'cPanel › outil **Redis** › page d’état, ligne **Mot de passe**.',
        '13, 22',
      ],
      [
        'Nom d’utilisateur GitHub',
        'Votre compte GitHub, demandé par `git clone`.',
        'github.com › photo de profil en haut à droite : le nom affiché en gras.',
        '15',
      ],
      [
        'Jeton GitHub (`github_pat_…`)',
        'Remplace votre mot de passe GitHub pour `git`.',
        'Créé à l’étape 14 ; affiché une seule fois : copiez-le aussitôt dans le gestionnaire. Perdu : en créer un nouveau (même étape).',
        '15',
      ],
      [
        'Commande `source …/bin/activate` et version `24`',
        'Active Node.js en SSH. Le `24` du chemin est la version de Node choisie.',
        '• cPanel › **Setup Node.js App** › crayon de l’application : commande en haut de la page.\n• En SSH : `ls ~/nodevenv/gestvente/source/api/` affiche la version (`24` ou `22`). Si c’est `22`, remplacez `/24/` par `/22/` partout (étapes 18, 23, 39, annexe B).',
        '17, 18, 23, 39',
      ],
      [
        '`PREMIER_SECRET_DE_48_CARACTERES`',
        'Valeur de `JWT_SECRET` : signe les sessions des utilisateurs.',
        'Première ligne affichée par l’étape 21 ; rangée dans le gestionnaire sous le nom `JWT_SECRET`.',
        '21, 22',
      ],
      [
        '`SECOND_SECRET_DE_48_CARACTERES`',
        'Valeur de `SAUVEGARDE_CLE` : chiffre les sauvegardes.',
        'Seconde ligne affichée par l’étape 21 ; rangée dans le gestionnaire sous le nom `SAUVEGARDE_CLE`.',
        '21, 30',
      ],
      [
        'Identifiant et mot de passe du concepteur',
        'Votre compte d’administration de la plateforme.',
        'L’identifiant, vous le choisissez à l’étape 24 ; le mot de passe est affiché une seule fois par cette étape.',
        '24, 32',
      ],
      [
        'Commerce : nom, téléphone `+224…`, préfixe `MAD`, identifiant `adil`',
        'Les informations d’Adil Phone et de son propriétaire.',
        'Vos choix. Le téléphone au format international (`+224` puis le numéro sans le 0 initial) ; le préfixe des factures : 2 à 5 lettres propres à chaque boutique.',
        '33',
      ],
    ],
    [2.3, 2.6, 4.1, 1.5],
  ),
  H2('1.5 Valeurs à retrouver plus tard (administration)'),
  ...tableau(
    ['Dans le guide', 'Ce que c’est', 'Où la trouver exactement', 'Chapitre'],
    [
      [
        '`20261127-023000`',
        'Date et heure d’une sauvegarde, dans le nom de son fichier.',
        'En SSH : `ls -lh ~/gestvente/sauvegardes` ; recopiez la partie `AAAAMMJJ-HHMMSS` du fichier voulu.',
        '17.4',
      ],
      [
        '`IDENTIFIANT_VERSION`',
        'Version du code vers laquelle revenir.',
        'En SSH : `cd ~/gestvente/source && git log --oneline -5` ; les 7 premiers caractères de la ligne voulue.',
        '16.2',
      ],
      [
        'Adresse e-mail des tâches Cron',
        'Reçoit les erreurs des tâches planifiées.',
        'Votre propre adresse e-mail, lue régulièrement.',
        'Étape 31',
      ],
      [
        '`SMS_URL`, `SMS_CLE`, `SMS_EXPEDITEUR`',
        'Accès à la passerelle d’envoi de SMS.',
        'Fournis par votre opérateur ou agrégateur SMS (contrat, espace client de la passerelle, section « API »). L’expéditeur doit souvent être validé par lui.',
        'Étape 37',
      ],
      [
        '`WHATSAPP_NUMERO_ID`, `WHATSAPP_JETON`',
        'Accès à WhatsApp Business Cloud.',
        'developers.facebook.com › votre application › **WhatsApp** › **Configuration de l’API** : « Identifiant du numéro de téléphone ». Jeton permanent : Meta Business Suite › **Paramètres d’entreprise** › **Utilisateurs système** › Générer un jeton.',
        'Étape 37',
      ],
      [
        '`C:\\Users\\mamad\\Pictures\\github\\Adil-gestVentephone`',
        'Dossier du projet sur votre ordinateur.',
        'Ne changez rien si le projet est à cet endroit. Sinon : dans l’Explorateur, ouvrez le dossier du projet, cliquez dans la barre d’adresse et copiez le chemin.',
        'Étapes 2, 26',
      ],
    ],
    [2.3, 2.6, 4.1, 1.5],
  ),
  H2('1.6 Retrouver vos valeurs en SSH'),
  P(
    'Une fois connecté (étape 7), ces commandes affichent la plupart des valeurs de l’hébergement :',
  ),
  ...ssh(`
whoami                                  # IDENTIFIANT
hostname                                # NOM_DU_SERVEUR
echo $HOME                              # dossier personnel (~)
uapi DomainInfo list_domains            # mondomaine.com (ligne main_domain)
ls ~/nodevenv/gestvente/source/api/     # version de Node (après l'étape 17)
ls -lh ~/gestvente/sauvegardes          # noms des sauvegardes (après l'étape 30)
`),
  ...encadre('info', [
    'Astuce : pour remplacer d’un coup les valeurs dans une commande, copiez-la d’abord dans le Bloc-notes, utilisez **Édition › Remplacer** (Ctrl+H), puis collez-la dans le terminal.',
    'Dans un terminal SSH, le collage se fait par **clic droit** (ou Ctrl+Maj+V), pas toujours par Ctrl+V.',
  ]),
  H2('1.7 Durée totale'),
  ...tableau(
    ['Partie', 'Contenu', 'Durée'],
    [
      ['A. Préparer', 'Ordinateur, fiche d’informations', '30 min'],
      ['B. Hébergement', 'cPanel, SSH, domaines, HTTPS, PostgreSQL, Redis', '1 h'],
      ['C. API', 'Code, application Node.js, construction, configuration, démarrage', '1 h'],
      ['D. Site web', 'Construction sur le PC, envoi, réglages', '30 min'],
      ['E. Mise en service', 'Tâches planifiées, sauvegardes, comptes, boutiques, employés', '1 h'],
      ['Total', 'Première installation complète', '≈ 4 h'],
    ],
    [2.5, 5.5, 2],
  ),
  P(
    'Prévoyez une demi-journée calme, avec une connexion Internet stable. L’installation peut se faire en plusieurs fois : chaque partie se termine par un point de contrôle.',
  ),
);

// ── 2. Vue d'ensemble ───────────────────────────────────────────────────────
ajouter(
  H1('2. Vue d’ensemble'),
  H2('2.1 Ce qui sera installé'),
  ...tableau(
    ['Élément', 'Rôle', 'Où chez o2switch'],
    [
      [
        'API (serveur)',
        'Comptes, ventes, stock, synchronisation des appareils, rappels de crédit, rapports, abonnements.',
        'Outil cPanel **Setup Node.js App** (Node.js 24, Phusion Passenger) — `api.mondomaine.com`',
      ],
      [
        'Site web (application installable)',
        'L’application, dans le navigateur ou installée sur l’ordinateur / le téléphone ; fonctionne hors ligne.',
        'Fichiers statiques — `app.mondomaine.com`',
      ],
      [
        'Base de données',
        'Toutes les données des commerces.',
        'cPanel **Bases de données PostgreSQL**',
      ],
      [
        'Redis',
        'Files d’envoi (SMS, WhatsApp), rappels automatiques, limitation des tentatives de connexion.',
        'Outil o2switch **Redis** (instance privée)',
      ],
      [
        'Fichiers',
        'Photos des produits et des appareils repris, justificatifs, rapports archivés.',
        'Dossier `~/gestvente/stockage`',
      ],
      [
        'Tâches planifiées',
        'Maintien en éveil de l’API, sauvegarde chiffrée quotidienne.',
        'cPanel **Tâches Cron**',
      ],
    ],
    [2.2, 4, 3.8],
  ),
  H2('2.2 Schéma'),
  ...code(`
 Navigateur / application installée          Téléphones Android, iOS
            │  https://app.mondomaine.com                │
            ▼                                            │
   Site web (fichiers statiques + .htaccess)             │
            │  appels https://api.mondomaine.com/api ◄───┘
            ▼
   API NestJS  (Passenger, Node.js 24)  ── dossier ~/gestvente/source/api
     ├── PostgreSQL  127.0.0.1:5432
     ├── Redis       127.0.0.1:PORT_REDIS
     └── Fichiers    ~/gestvente/stockage
`),
  H2('2.3 Ce qu’il faut savoir avant de commencer'),
  ...encadre('ok', [
    '**PostgreSQL 9.6 testé.** L’Offre Cloud fournit PostgreSQL en version **9.6**. Le 27 octobre 2026, les 13 migrations de la base et les 155 tests de bout en bout de l’API ont réussi sur PostgreSQL 9.6.24 : l’application fonctionne avec cette version.',
  ]),
  ...encadre('attention', [
    '**PostgreSQL pourrait disparaître de l’offre.** La FAQ o2switch indique qu’il est « probable » qu’o2switch arrête PostgreSQL (version figée par cPanel). La 9.6 ne reçoit plus de correctifs de sécurité ; elle n’est joignable que depuis le serveur lui-même (127.0.0.1), ce qui limite le risque. Plan de secours au chapitre 20 ; les sauvegardes quotidiennes permettent de déménager à tout moment.',
  ]),
  ...encadre('info', [
    '**Hébergement mutualisé.** L’Offre Cloud (12 threads, 48 Go de mémoire, partagés) suffit pour Adil Phone et quelques commerces abonnés. Pas de Docker ni d’accès administrateur : tout se fait avec cPanel et le SSH.',
    '**Redis n’est pas permanent** chez o2switch : son contenu est perdu si le serveur redémarre. Les données restent intactes (elles sont dans PostgreSQL) ; au pire, un SMS en attente à ce moment-là est perdu.',
    '**L’API peut être mise en veille** quand personne ne l’utilise. Une tâche planifiée la réveille toutes les 5 minutes (étape 31) pour que les rappels de crédit (9 h) et les rapports (7 h) partent à l’heure.',
    '**Mots de passe des utilisateurs.** L’application n’a pas d’écran pour changer soi-même son mot de passe : le concepteur génère celui du propriétaire, le propriétaire génère ceux des employés (mot de passe provisoire affiché une fois). Au quotidien, chacun déverrouille avec son code PIN.',
  ]),
);

// ── PARTIE A ────────────────────────────────────────────────────────────────
ajouter(
  H1('3. Partie A — Préparer votre ordinateur'),
  P('Votre ordinateur sert à vous connecter au serveur et à construire le site web.'),
  ETAPE('Vérifier les logiciels de l’ordinateur', '15 min'),
  P('Ouvrez **PowerShell** (touche Windows, tapez « PowerShell », Entrée) et tapez :'),
  ...ps(`
git --version
node --version
pnpm --version
ssh -V
`),
  resultat('quatre numéros de version : Git, Node.js **v24** (ou 22 au moins), pnpm, OpenSSH.'),
  P('Si une commande est inconnue :'),
  ...tableau(
    ['Logiciel manquant', 'Installation'],
    [
      ['Git', 'git-scm.com › Download for Windows, options par défaut.'],
      [
        'Node.js',
        'nodejs.org › version LTS 24, options par défaut. Fermez puis rouvrez PowerShell.',
      ],
      ['pnpm', 'Dans PowerShell : `npm install -g pnpm@12.9.1`'],
      [
        'OpenSSH',
        'Paramètres Windows › Applications › Fonctionnalités facultatives › Ajouter « Client OpenSSH ».',
      ],
    ],
    [3, 7],
  ),
  ETAPE('Récupérer le projet à jour', '5 min'),
  ...ps(`
cd C:\\Users\\mamad\\Pictures\\github\\Adil-gestVentephone
git checkout main
git pull
`),
  resultat('`Already up to date.` ou la liste des fichiers mis à jour, sans erreur.'),
  ETAPE('Préparer un gestionnaire de mots de passe', '10 min'),
  P(
    'Installez **Bitwarden** ou **KeePassXC** si vous n’en avez pas. Créez un dossier « GestVente o2switch ». Vous y rangerez, au fil du guide : mot de passe cPanel, codes de secours de la double authentification, phrase de passe de la clé SSH, jeton GitHub, mots de passe PostgreSQL et Redis, `JWT_SECRET`, `SAUVEGARDE_CLE`, mot de passe du concepteur.',
  ),
  H2('3.1 Fiche des informations (sans mot de passe)'),
  ...tableau(
    ['Information', 'Valeur'],
    [
      ['Identifiant cPanel (`IDENTIFIANT`)', ''],
      ['Nom du serveur (`NOM_DU_SERVEUR`)', ''],
      ['Adresse de cPanel', ''],
      ['Nom de domaine (`mondomaine.com`)', ''],
      ['Base et utilisateur PostgreSQL (`IDENTIFIANT_gestvente`)', ''],
      ['Port Redis (`PORT_REDIS`)', ''],
      ['Nom d’utilisateur GitHub', ''],
      ['Commande « source » de l’application Node.js (étape 17)', ''],
      ['Identifiant du concepteur', ''],
      ['Identifiant du propriétaire d’Adil Phone', ''],
      ['Date de mise en service', ''],
      ['Date d’expiration du jeton GitHub', ''],
      ['Date de renouvellement de l’offre o2switch', ''],
    ],
    [5, 5],
  ),
);

// ── PARTIE B ────────────────────────────────────────────────────────────────
ajouter(
  H1('4. Partie B — Préparer l’hébergement'),
  ETAPE('Se connecter à cPanel et le sécuriser', '15 min'),
  ...actions([
    'Connectez-vous à l’**espace client o2switch** avec les accès de l’e-mail de bienvenue ; vérifiez que l’adresse e-mail de contact est une adresse que vous lisez (avis de renouvellement, alertes).',
    'Ouvrez **cPanel** (lien depuis l’espace client, ou adresse indiquée dans l’e-mail de bienvenue).',
    'En haut à droite, menu de votre compte › **Changer de langue** › **Français** si cPanel est en anglais.',
    'Si le mot de passe cPanel vous a été envoyé par e-mail : menu de votre compte › **Mot de passe et sécurité** › changez-le, rangez-le dans le gestionnaire.',
    'Menu de votre compte › **Authentification à deux facteurs** › **Configurer l’authentification à deux facteurs**. Scannez le QR code avec une application (Google Authenticator, Aegis, Microsoft Authenticator), tapez le code à 6 chiffres, **Configurer**.',
  ]),
  resultat('à la prochaine connexion, cPanel demande le code à 6 chiffres de l’application.'),
  ...encadre(
    'danger',
    'Notez la **date de renouvellement** de l’offre dans votre agenda : si elle expire, l’application s’arrête pour tous les commerces.',
  ),
  H2('4.1 Les outils cPanel utilisés'),
  ...tableau(
    ['Outil (zone de recherche de cPanel)', 'Étapes'],
    [
      ['Autorisation SSH, Accès SSH', '5 à 7'],
      ['Domaines, SSL/TLS Status', '8 à 10'],
      ['Bases de données PostgreSQL, phpPgAdmin', '11, 12'],
      ['Redis', '13'],
      ['Setup Node.js App', '17, 25'],
      ['Gestionnaire de fichiers', '27'],
      ['Tâches Cron', '31'],
      ['JetBackup, Utilisation des ressources, Erreurs', 'Partie F'],
    ],
    [7, 3],
  ),
  P('Pour trouver un outil, tapez son nom dans la zone **Rechercher** en haut de cPanel.'),

  H2('4.2 Accès SSH'),
  P(
    'Le SSH ouvre un terminal sur le serveur. Chez o2switch, le pare-feu refuse toute connexion SSH tant que votre adresse IP n’est pas autorisée.',
  ),
  ETAPE('Autoriser votre adresse IP', '5 min'),
  ...actions([
    'Dans cPanel, ouvrez **Autorisation SSH**.',
    'Le champ propose votre adresse IP actuelle (vérifiable sur mon-ip.io). Laissez-la, choisissez **SSH** (entrée et sortie si demandé), validez.',
    'Attendez **5 minutes** : le pare-feu met ce délai à prendre la règle.',
  ]),
  resultat('votre adresse apparaît dans la liste des autorisations.'),
  ...encadre('attention', [
    'En Guinée, l’adresse IP d’une box ou d’une clé 4G **change souvent**. Si un jour la connexion SSH échoue par « Connection timed out », revenez ici et ajoutez la nouvelle adresse. Le nombre d’autorisations est limité (5 par compte) : supprimez les anciennes.',
  ]),
  ETAPE('Créer votre clé SSH', '10 min'),
  ...ps(`
ssh-keygen -t ed25519 -C "gestvente-o2switch"
`),
  ...actions([
    '« Enter file in which to save the key » : appuyez sur **Entrée** (emplacement proposé).',
    '« Enter passphrase » : choisissez une **phrase de passe** (rangez-la dans le gestionnaire), Entrée, puis retapez-la.',
  ]),
  resultat(
    '`Your public key has been saved in C:\\Users\\<vous>/.ssh/id_ed25519.pub` et un dessin de caractères.',
  ),
  P('Affichez la clé **publique** et copiez la ligne entière (elle commence par `ssh-ed25519`) :'),
  ...ps(`
Get-Content $env:USERPROFILE\\.ssh\\id_ed25519.pub
`),
  ...actions([
    'Dans cPanel, ouvrez **Accès SSH** › **Gérer les clés SSH** › **Importer une clé**.',
    'Nom : `gestvente-pc`. Collez la clé dans le champ **clé publique** (laissez la clé privée vide). **Importer**.',
    'Revenez à **Gérer les clés SSH** : dans **Clés publiques**, ligne `gestvente-pc`, cliquez sur **Gérer** › **Autoriser**.',
  ]),
  resultat('l’état de la clé indique **autorisée**.'),
  ...encadre(
    'danger',
    'Le fichier `id_ed25519` **sans extension** est la clé **privée** : ne l’envoyez jamais à personne, ne le copiez pas sur le serveur. Seule la clé `.pub` se partage.',
  ),
  ETAPE('Se connecter en SSH pour la première fois', '10 min'),
  P(
    'On crée un **raccourci** nommé `o2switch` : ensuite, `ssh o2switch` suffira pour se connecter. Il vise le **nom du serveur** o2switch, qui fonctionne tout de suite (le nom de domaine, lui, n’est relié qu’à l’étape 8).',
  ),
  ...actions([
    'Dans cPanel, colonne de droite **Informations générales** : notez le **Nom du serveur** (Server Name), de la forme `xxxxx.o2switch.net`. Il figure aussi dans l’e-mail de bienvenue d’o2switch.',
    'Copiez le bloc ci-dessous dans le Bloc-notes, remplacez `NOM_DU_SERVEUR` et `IDENTIFIANT`, puis collez le tout dans PowerShell et appuyez sur Entrée.',
  ]),
  ...ps(`
@"
Host o2switch
    HostName NOM_DU_SERVEUR
    User IDENTIFIANT
    IdentityFile ~/.ssh/id_ed25519
"@ | Set-Content -Path $env:USERPROFILE\\.ssh\\config -Encoding ascii
`),
  P('Vérifiez que le raccourci est bien lu :'),
  ...ps(`
Get-ChildItem $env:USERPROFILE\\.ssh
ssh -G o2switch | Select-String "^hostname|^user "
`),
  resultat(
    'la liste contient un fichier **config** (sans `.txt`) à côté de `id_ed25519` et `id_ed25519.pub` ; puis `hostname xxxxx.o2switch.net` et `user IDENTIFIANT` avec vos valeurs. Si `hostname o2switch` s’affiche, le fichier n’est pas lu : voir le Dépannage.',
  ),
  P(
    'Connectez-vous, **toujours depuis PowerShell sur votre ordinateur**, jamais depuis le Terminal de cPanel :',
  ),
  ...ps(`
ssh o2switch
`),
  ...actions([
    'À la première connexion : « Are you sure you want to continue connecting (yes/no) ? » → tapez `yes`, Entrée.',
    'Tapez la phrase de passe de la clé.',
  ]),
  resultat('une invite du type `[IDENTIFIANT@serveur ~]$`. Vous êtes sur le serveur.'),
  ...ssh(`
whoami
pwd
`),
  resultat('votre identifiant cPanel, puis `/home/IDENTIFIANT`. Pour quitter le serveur : `exit`.'),
  ...encadre(
    'info',
    'Utilisez toujours ce terminal (PowerShell, Windows Terminal) plutôt que le **Terminal** intégré à cPanel, trop limité en mémoire pour les installations.',
  ),
);

ajouter(
  H1('5. Domaine, sous-domaines et HTTPS'),
  ETAPE('Relier le domaine à l’hébergement', '5 min (+ propagation)'),
  ...encadre('attention', [
    '**Ajouter un domaine dans cPanel ne l’achète pas.** cPanel › **Domaines** dit seulement au serveur quoi faire du domaine ; le domaine doit aussi être **enregistré** (acheté) auprès d’un registraire, sinon il n’existe pas sur Internet et le navigateur affiche « Ce site est inaccessible ».',
    'Vérifiez depuis PowerShell : `Resolve-DnsName mondomaine.com -Server 1.1.1.1`. La réponse « Le nom DNS n’existe pas » veut dire que le domaine n’est pas enregistré (ou qu’il est mal orthographié).',
  ]),
  P(
    '**Cas 0 — vous n’avez pas encore de domaine** : l’Offre Cloud inclut **un nom de domaine offert** (.com, .fr, .net, .org…) tant que l’hébergement est actif. Indice : si l’espace client › **Domaines configurés** affiche comme **Domaine principal** une adresse du type `IDENTIFIANT.odns.fr` (domaine technique fourni par o2switch), le domaine offert n’a pas encore été utilisé.',
  ),
  ...actions([
    'Connectez-vous à l’**espace client o2switch** (pas cPanel) et ouvrez la partie **Domaines**.',
    'Cherchez le nom voulu (par exemple `mondomaine.com`) et vérifiez qu’il est **disponible**.',
    'Commandez-le en tant que domaine offert avec l’hébergement, et remplissez les coordonnées du titulaire (les vôtres ou celles de l’entreprise) : elles doivent être exactes.',
    'Si le domaine offert n’apparaît pas ou qu’un prix est demandé, contactez le support o2switch (ticket ou téléphone) en indiquant votre identifiant cPanel et le domaine voulu : ils le rattachent à votre hébergement.',
    'Confirmez l’**e-mail de vérification du titulaire** reçu dans les jours suivants : sans cela, le domaine est suspendu au bout de 15 jours.',
  ]),
  resultat(
    'l’espace client montre le domaine à l’état **Actif**, et quelques heures plus tard `Resolve-DnsName mondomaine.com -Server 1.1.1.1` affiche l’adresse IP de l’hébergement. Le domaine commandé chez o2switch utilise automatiquement ses serveurs DNS : passez au cas 1.',
  ),
  P(
    '**Cas 1 — domaine commandé chez o2switch** : il est déjà relié ; s’il n’apparaît pas encore dans cPanel › **Domaines**, ajoutez-le (**Créer un domaine**, sans cocher « Partager la racine du document »). Passez à l’étape suivante.',
  ),
  P(
    '**Cas 2 — domaine chez un autre registraire** : chez ce registraire, choisissez l’une des deux solutions :',
  ),
  ...tableau(
    ['Solution', 'Réglage chez le registraire'],
    [
      [
        'Serveurs DNS d’o2switch (conseillé)',
        'Remplacer les serveurs de noms par ceux d’o2switch : `ns1.o2switch.net` et `ns2.o2switch.net` (à confirmer dans l’e-mail de bienvenue).',
      ],
      [
        'Enregistrements A',
        '`@`, `app` et `api` → adresse IP de l’hébergement (cPanel, colonne de droite, « Adresse IP partagée »).',
      ],
    ],
    [3.5, 6.5],
  ),
  resultat(
    'après la propagation (de quelques minutes à 24 h), `ping mondomaine.com` dans PowerShell affiche l’adresse IP de l’hébergement.',
  ),
  ETAPE('Créer les sous-domaines app et api', '10 min'),
  ...actions([
    'Dans cPanel, ouvrez **Domaines** › **Créer un domaine**.',
    'Domaine : `app.mondomaine.com`. Décochez **Partager la racine du document** si la case est cochée. Racine du document : `app.mondomaine.com` (proposé). **Envoyer**.',
    'Recommencez avec `api.mondomaine.com` (racine : `api.mondomaine.com`). Ce dossier restera vide : Passenger y redirige vers l’API.',
  ]),
  resultat(
    'les deux sous-domaines apparaissent dans la liste **Domaines**, et les dossiers `~/app.mondomaine.com` et `~/api.mondomaine.com` existent (`ls ~` en SSH).',
  ),
  ETAPE('Activer HTTPS', '10 min'),
  ...actions([
    'Dans cPanel, ouvrez **SSL/TLS Status**. Cochez `app.mondomaine.com` et `api.mondomaine.com` puis **Run AutoSSL** si un cadenas n’est pas vert.',
    'Patientez quelques minutes et rechargez la page.',
    'Dans **Domaines**, activez l’interrupteur **Forcer la redirection HTTPS** sur les deux sous-domaines.',
  ]),
  resultat(
    '`https://app.mondomaine.com` s’ouvre avec un cadenas dans le navigateur (page vide ou liste de dossier pour l’instant).',
  ),
  ...encadre(
    'danger',
    'L’application installable **exige** HTTPS : sans certificat valide, sa base locale, l’installation et le mode hors ligne ne fonctionnent pas.',
  ),
);

ajouter(
  H1('6. Base de données PostgreSQL'),
  ETAPE('Créer la base, l’utilisateur et les droits', '10 min'),
  P(
    'Générez d’abord le mot de passe de la base, **uniquement des lettres et des chiffres** (les symboles `@ : / # %` cassent l’adresse de connexion). En SSH :',
  ),
  ...ssh(`
openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40; echo
`),
  P(
    'Copiez le résultat dans le gestionnaire de mots de passe (`MOT_DE_PASSE_PG`), puis dans cPanel, **Bases de données PostgreSQL** :',
  ),
  ...actions([
    '**Créer une nouvelle base de données** : `gestvente` › **Créer une base de données**. Nom réel : `IDENTIFIANT_gestvente`.',
    '**Ajouter un nouvel utilisateur** : nom `gestvente`, mot de passe `MOT_DE_PASSE_PG` (deux fois) › **Créer un utilisateur**. Nom réel : `IDENTIFIANT_gestvente`.',
    '**Ajouter un utilisateur à une base de données** : utilisateur `IDENTIFIANT_gestvente`, base `IDENTIFIANT_gestvente` › **Envoyer** ; cochez **TOUS LES PRIVILÈGES** › **Effectuer des modifications**.',
  ]),
  resultat(
    'dans la liste **Bases de données actuelles**, la base `IDENTIFIANT_gestvente` a l’utilisateur `IDENTIFIANT_gestvente`.',
  ),
  ETAPE('Tester la connexion à la base', '5 min'),
  ...ssh(`
psql -h 127.0.0.1 -U IDENTIFIANT_gestvente -d IDENTIFIANT_gestvente -c "select version();"
`),
  P(
    'Le mot de passe `MOT_DE_PASSE_PG` est demandé (rien ne s’affiche pendant la saisie, c’est normal).',
  ),
  resultat('une ligne commençant par `PostgreSQL 9.6`.'),
  ...encadre('info', [
    'Utilisez toujours `127.0.0.1` et non `localhost` : `localhost` peut passer par IPv6 et être refusé.',
    '**phpPgAdmin** (cPanel) permet de consulter les tables dans le navigateur. Ne modifiez jamais de données à la main : les appareils ne seraient pas synchronisés.',
  ]),
);

ajouter(
  H1('7. Redis'),
  ETAPE('Démarrer l’instance Redis privée', '10 min'),
  ...actions([
    'Dans cPanel, ouvrez l’outil **Redis**.',
    'À la première ouverture : version **7**, mode **Port** (plus simple à configurer que le mode Socket). Validez.',
    'Sur la page d’état, notez le **port** (`PORT_REDIS`, dans la fiche) et le **mot de passe** (`MOT_DE_PASSE_REDIS`, dans le gestionnaire).',
  ]),
  P(
    'Le programme `redis-cli` n’est pas installé pour les comptes o2switch (« command not found ») : le test passe directement par le shell. Copiez la commande en une seule ligne, en remplaçant `PORT_REDIS` et `MOT_DE_PASSE_REDIS` (gardez les apostrophes autour du mot de passe) :',
  ),
  ...ssh(`
exec 3<>/dev/tcp/127.0.0.1/PORT_REDIS && printf 'AUTH %s\\r\\nPING\\r\\n' 'MOT_DE_PASSE_REDIS' >&3 && timeout 2 cat <&3; exec 3>&-
`),
  resultat('deux lignes : `+OK` (mot de passe accepté) puis `+PONG` (Redis répond).'),
  ...tableau(
    ['Message affiché', 'Cause et solution'],
    [
      [
        '`Connexion refusée` / `Connection refused`',
        'L’instance n’est pas démarrée ou le port est faux : rouvrez cPanel › **Redis**, vérifiez l’état « en marche » et recopiez le port.',
      ],
      [
        '`-WRONGPASS` ou `-ERR invalid password`',
        'Mot de passe mal recopié : recopiez-le depuis la page d’état de l’outil Redis.',
      ],
      [
        'Rien ne s’affiche',
        'Mode **Socket** choisi au lieu de **Port** : dans l’outil Redis, arrêtez l’instance et recréez-la en mode Port.',
      ],
    ],
    [35, 65],
  ),
  ...encadre(
    'info',
    'GestVente préfixe ses clés par `gestvente` : la même instance Redis peut servir à un autre site sans conflit.',
  ),
  ...encadre('verif', [
    '**Fin de la partie B.** Vous devez avoir : la double authentification sur cPanel ; une connexion `ssh o2switch` qui fonctionne ; `app.mondomaine.com` et `api.mondomaine.com` en HTTPS ; `select version()` qui répond 9.6 ; `+PONG` de Redis.',
  ]),
);

// ── PARTIE C ────────────────────────────────────────────────────────────────
ajouter(
  H1('8. Partie C — Installer l’API'),
  H2('8.1 Le code source'),
  ETAPE('Créer un jeton GitHub en lecture seule', '10 min'),
  ...actions([
    'Sur github.com, connecté : photo de profil › **Settings** › **Developer settings** › **Personal access tokens** › **Fine-grained tokens** › **Generate new token**.',
    'Token name : `o2switch-gestvente`. Expiration : **1 an** (notez la date dans la fiche). Resource owner : `MOUSTO-HUB`.',
    'Repository access : **Only select repositories** › `Adil-gestVentephone`.',
    'Permissions › Repository permissions › **Contents : Read-only**. Rien d’autre.',
    '**Generate token**, copiez le jeton (commence par `github_pat_`) dans le gestionnaire : il n’est affiché qu’une fois.',
  ]),
  ETAPE('Préparer les dossiers et cloner le dépôt', '10 min'),
  ...ssh(`
mkdir -p ~/gestvente/stockage ~/gestvente/sauvegardes ~/gestvente/scripts ~/gestvente/journaux
chmod 700 ~/gestvente/stockage ~/gestvente/sauvegardes ~/gestvente/scripts
cd ~/gestvente
git clone https://github.com/MOUSTO-HUB/Adil-gestVentephone.git source
`),
  ...actions([
    '« Username » : votre nom d’utilisateur GitHub.',
    '« Password » : collez le **jeton** (pas votre mot de passe GitHub). Rien ne s’affiche pendant le collage.',
  ]),
  resultat(
    '`Receiving objects: 100%` puis l’invite revient. `ls ~/gestvente/source` affiche `api  app  docs  packages  …`.',
  ),
  P(
    'Enregistrez le jeton pour les mises à jour (fichier `~/.git-credentials`, lisible par vous seul) :',
  ),
  ...ssh(`
cd ~/gestvente/source
git config credential.helper store
git pull
`),
  P('`git pull` redemande une dernière fois l’utilisateur et le jeton, puis les mémorise.'),
  resultat('`Already up to date.`'),
  ...encadre(
    'danger',
    'Le code va dans `~/gestvente/source`, **jamais** dans `public_html` ni dans le dossier d’un domaine : ses fichiers, dont `.env` et ses secrets, seraient téléchargeables.',
  ),
  H2('8.2 Organisation des dossiers'),
  ...code(`
~/gestvente/
├── source/          code (Git) ; l'API est dans source/api
├── stockage/        photos, justificatifs, rapports (STOCKAGE_DIR)
├── sauvegardes/     sauvegardes chiffrées quotidiennes
├── scripts/         sauvegarde.sh, sauvegarde.env, mettre-a-jour.sh
└── journaux/        journal de l'API et des tâches planifiées
~/app.mondomaine.com/   site web (fichiers statiques + .htaccess)
~/api.mondomaine.com/   vide (géré par Passenger)
`),
);

ajouter(
  H1('9. L’application Node.js'),
  ETAPE('Créer le fichier de démarrage passenger.cjs', '5 min'),
  P(
    'L’API est écrite en « modules ES » ; Passenger démarre plus sûrement un petit fichier classique qui la charge. Copiez tout le bloc d’un coup :',
  ),
  ...ssh(`
cat > ~/gestvente/source/api/passenger.cjs <<'FIN'
// Point d'entrée de Phusion Passenger (o2switch) : l'API est en modules ES.
import('./dist/main.js').catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
FIN
cat ~/gestvente/source/api/passenger.cjs
`),
  resultat(
    'le contenu du fichier s’affiche (5 lignes). Il n’est pas suivi par Git : il survit aux mises à jour.',
  ),
  ETAPE('Déclarer l’application dans Setup Node.js App', '10 min'),
  P('Dans cPanel, ouvrez **Setup Node.js App** › **Create Application** et remplissez :'),
  ...tableau(
    ['Champ', 'Valeur', 'Explication'],
    [
      ['Node.js version', '`24` (sinon `22`)', 'Le projet exige Node 22 ou plus.'],
      ['Application mode', '`Production`', 'Définit `NODE_ENV=production`.'],
      [
        'Application root',
        '`gestvente/source/api`',
        'Dossier de l’API (relatif à votre dossier personnel).',
      ],
      ['Application URL', '`api.mondomaine.com`, chemin vide', 'Adresse publique de l’API.'],
      ['Application startup file', '`passenger.cjs`', 'Fichier créé à l’étape précédente.'],
      [
        'Passenger log file',
        '`/home/IDENTIFIANT/gestvente/journaux/api.log`',
        'Journal des erreurs de l’API.',
      ],
    ],
    [2.6, 3.6, 3.8],
  ),
  ...actions([
    'Ne touchez pas à **Environment variables** : la configuration sera dans un fichier `.env` (étape 22).',
    'Cliquez sur **Create**.',
    'En haut de la page apparaît une commande du type `source /home/IDENTIFIANT/nodevenv/gestvente/source/api/24/bin/activate && cd /home/IDENTIFIANT/gestvente/source/api`. **Copiez-la dans la fiche** : elle active Node.js en SSH avant chaque intervention.',
    'Ne cliquez **jamais** sur **Run NPM Install** : le projet utilise pnpm (étape 19). L’outil crée aussi un lien `api/node_modules` vers `~/nodevenv/…` ; l’étape 19 le remplace par un vrai dossier.',
    'Cliquez sur **Stop App** : l’API ne peut pas démarrer avant d’être construite.',
  ]),
  resultat('l’application apparaît dans la liste de **Setup Node.js App**, état **stopped**.'),
  ...encadre(
    'info',
    `Dans ce guide, la commande d’activation est écrite \`${ACTIVER}\`. Si la vôtre est différente (autre version de Node), utilisez toujours **la vôtre**.`,
  ),
);

ajouter(
  H1('10. Construire l’API'),
  ETAPE('Activer Node.js et installer pnpm', '5 min'),
  ...ssh(`
${ACTIVER}
node --version
npm install -g pnpm@12.9.1
pnpm --version
`),
  resultat(
    '`v24.x.x` puis `12.9.1`. L’invite commence maintenant par `(gestvente/source/api:24)` : Node.js est activé.',
  ),
  ...encadre(
    'attention',
    'Chaque nouvelle connexion SSH repart **sans** Node.js activé : retapez la commande `source …` avant toute commande `node`, `pnpm` ou `npm`.',
  ),
  ETAPE('Installer les dépendances', '5 à 10 min'),
  ...ssh(`
cd ~/gestvente/source
if [ -L api/node_modules ]; then rm api/node_modules; fi
NODE_ENV=development pnpm install --frozen-lockfile --filter "@gestvente/api..."
`),
  resultat(
    'la dernière ligne indique `Done in …`. Des avertissements jaunes (« WARN ») sont normaux ; une ligne rouge « ERR_PNPM » ne l’est pas.',
  ),
  ...encadre('attention', [
    'Ne sautez aucune des deux lignes, sinon l’installation échoue avec `sh: prisma: command not found` puis `ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED` :',
    '• `if [ -L api/node_modules ] …` : à l’étape 17, Setup Node.js App a remplacé le dossier `api/node_modules` par un **lien** vers `~/nodevenv/…`. pnpm installerait alors au mauvais endroit. La ligne supprime ce lien (seulement le lien, rien d’autre) ; pnpm crée ensuite un vrai dossier.',
    '• `NODE_ENV=development` : l’application est en mode Production ; sans ce préfixe, pnpm n’installe pas les outils de construction (Prisma, NestJS, TypeScript). Il ne vaut que pour cette commande : l’API tourne bien en production.',
  ]),
  P(
    'Contrôle : la commande suivante doit afficher un **dossier** (ligne commençant par `d`), pas un lien (`l`) :',
  ),
  ...ssh(`
ls -ld api/node_modules
`),
  ETAPE('Construire le code partagé et l’API', '5 min'),
  ...ssh(`
pnpm --filter @gestvente/commun build
pnpm --filter @gestvente/api exec prisma generate
pnpm --filter @gestvente/api build
ls api/dist/main.js
`),
  resultat(
    '`✔ Generated Prisma Client` pour la deuxième commande, aucune erreur pour la troisième, et `api/dist/main.js` affiché par la dernière.',
  ),
  ...encadre('info', [
    'En cas de `JavaScript heap out of memory`, tapez `export NODE_OPTIONS=--max-old-space-size=2048` puis relancez la commande qui a échoué.',
    'Les compilateurs (gcc, make) sont bloqués chez o2switch ; ce projet n’en a pas besoin (les modules natifs arrivent précompilés).',
  ]),
);

ajouter(
  H1('11. Configurer l’API (fichier .env)'),
  ETAPE('Générer les deux secrets', '5 min'),
  ...ssh(`
openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | cut -c1-48; echo
openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | cut -c1-48; echo
`),
  P(
    'Deux lignes de 48 caractères s’affichent. Rangez la première comme `JWT_SECRET` et la seconde comme `SAUVEGARDE_CLE` dans le gestionnaire.',
  ),
  ...encadre('danger', [
    '**Sans `SAUVEGARDE_CLE`, les sauvegardes sont illisibles.** Gardez-en une copie hors du serveur (gestionnaire de mots de passe).',
    'Changer `JWT_SECRET` plus tard déconnecte tous les appareils de tous les commerces.',
  ]),
  ETAPE('Créer le fichier .env', '10 min'),
  P(
    'Préparez d’abord le texte ci-dessous dans le Bloc-notes de votre ordinateur et remplacez chaque valeur en MAJUSCULES :',
  ),
  ...code(`
# Base et Redis (étapes 11 à 13)
DATABASE_URL=postgresql://IDENTIFIANT_gestvente:MOT_DE_PASSE_PG@127.0.0.1:5432/IDENTIFIANT_gestvente?schema=public
REDIS_URL=redis://default:MOT_DE_PASSE_REDIS@127.0.0.1:PORT_REDIS
REDIS_PREFIXE=gestvente

# Sécurité et adresses
JWT_SECRET=PREMIER_SECRET_DE_48_CARACTERES
APP_ORIGIN=https://app.mondomaine.com
URL_PUBLIQUE=https://api.mondomaine.com
STOCKAGE_DIR=/home/IDENTIFIANT/gestvente/stockage

# Messages aux clients : « journal » = rien n'est envoyé (voir étape 37)
SMS_FOURNISSEUR=journal
SMS_URL=
SMS_CLE=
SMS_EXPEDITEUR=GestVente
SMS_COUT=0
WHATSAPP_FOURNISSEUR=aucun
WHATSAPP_JETON=
WHATSAPP_NUMERO_ID=
WHATSAPP_COUT=0
`),
  P('Puis, en SSH, ouvrez l’éditeur `nano` :'),
  ...ssh(`
nano ~/gestvente/source/api/.env
`),
  ...actions([
    'Collez le texte préparé (clic droit dans le terminal).',
    'Enregistrez : **Ctrl+O**, puis **Entrée**.',
    'Quittez : **Ctrl+X**.',
  ]),
  P('Protégez le fichier et vérifiez-le :'),
  ...ssh(`
chmod 600 ~/gestvente/source/api/.env
ls -l ~/gestvente/source/api/.env
grep -c "=" ~/gestvente/source/api/.env
grep -n "MAJUSCULES\\|IDENTIFIANT\\|MOT_DE_PASSE\\|PORT_REDIS\\|SECRET_DE" ~/gestvente/source/api/.env
`),
  resultat(
    '`-rw-------` (lisible par vous seul), `17` lignes avec « = », et **aucune ligne** pour la dernière commande (toutes les valeurs ont été remplacées).',
  ),
  H2('11.1 Rôle de chaque variable'),
  ...tableau(
    ['Variable', 'Rôle'],
    [
      ['`DATABASE_URL`', 'Connexion à PostgreSQL.'],
      ['`REDIS_URL`', 'Connexion à Redis.'],
      ['`REDIS_PREFIXE`', 'Préfixe des clés Redis.'],
      ['`JWT_SECRET`', 'Signature des sessions des utilisateurs.'],
      [
        '`APP_ORIGIN`',
        'Adresse du site autorisée à appeler l’API (sans barre finale ; plusieurs adresses séparées par des virgules).',
      ],
      [
        '`URL_PUBLIQUE`',
        'Début des liens de factures envoyés aux clients : `https://api.mondomaine.com/api/f/…`.',
      ],
      ['`STOCKAGE_DIR`', 'Dossier des photos, justificatifs et rapports.'],
      ['`SMS_*`, `WHATSAPP_*`', 'Envoi des messages aux clients (étape 37).'],
    ],
    [2.6, 7.4],
  ),
);

ajouter(
  H1('12. Créer les tables et démarrer l’API'),
  ETAPE('Créer les tables de la base', '2 min'),
  ...ssh(`
${ACTIVER}
cd ~/gestvente/source/api
pnpm exec prisma migrate deploy
`),
  resultat('la liste des 13 migrations puis `All migrations have been successfully applied.`'),
  P(
    'En cas d’erreur `P1000: Authentication failed`, la ligne `DATABASE_URL` du fichier `.env` est fausse. Affichez-la (le mot de passe est masqué par des étoiles) et testez-la avec `psql` :',
  ),
  ...ssh(`
echo "Variable du shell : \${DATABASE_URL:-(aucune)}" | sed -E 's#(://[^:/@]*:)[^@]*@#\\1****@#'
grep -n "DATABASE_URL" .env | sed -E 's#(://[^:/@]*:)[^@]*@#\\1****@#'
psql "$(sed -n 's/^DATABASE_URL=//p' .env | sed 's/?schema=public//')" -c "select current_user;"
`),
  P('La deuxième commande doit afficher exactement cette forme, avec vos valeurs :'),
  ...code(`
1:DATABASE_URL=postgresql://IDENTIFIANT_gestvente:****@127.0.0.1:5432/
IDENTIFIANT_gestvente?schema=public
`),
  P('(une seule ligne sur le serveur ; coupée ici pour tenir sur la page)'),
  ...tableau(
    ['Ce que vous voyez', 'Correction'],
    [
      [
        '`Variable du shell` affiche autre chose que `(aucune)`',
        'Une ancienne valeur a été définie dans le terminal et passe avant le `.env` : tapez `unset DATABASE_URL`, puis relancez la migration.',
      ],
      [
        'La ligne `DATABASE_URL` n’a pas cette forme, ou l’utilisateur manque (`postgresql://:****@…`)',
        'Corrigez-la avec `nano .env` : rien avant `DATABASE_URL`, pas d’espace ni de guillemets, l’utilisateur complet (avec le préfixe `IDENTIFIANT_`) avant les `:`. Si Prisma affiche `(not available)` au lieu du nom d’utilisateur, c’est cette partie qui manque.',
      ],
      [
        '`psql` répond `password authentication failed`',
        'Le mot de passe du `.env` n’est pas celui de cPanel. Dans cPanel › **Bases de données PostgreSQL** › **Utilisateurs actuels**, cliquez sur **Changer le mot de passe** pour `IDENTIFIANT_gestvente`, collez `MOT_DE_PASSE_PG` du gestionnaire, puis recopiez-le dans `.env`.',
      ],
      [
        '`psql` affiche `IDENTIFIANT_gestvente` (une ligne `current_user`)',
        'Le `.env` est bon : relancez `pnpm exec prisma migrate deploy` depuis `~/gestvente/source/api`.',
      ],
    ],
    [4, 6],
  ),
  ETAPE('Créer le compte du concepteur', '3 min'),
  P(
    'Le **concepteur** (vous) administre la plateforme : il crée les commerces et leur propriétaire, enregistre les abonnements. Il ne voit jamais les ventes ni les clients.',
  ),
  ...ssh(`
node dist/cli/initialiser.js
`),
  ...actions([
    '« Nom du concepteur » : votre nom.',
    '« Identifiant de connexion » : par exemple `concepteur` (3 à 40 lettres, chiffres, `.` `_` `-`).',
  ]),
  resultat(
    '`Compte du concepteur créé.`, l’identifiant et un **mot de passe affiché une seule fois** : copiez-le immédiatement dans le gestionnaire.',
  ),
  ETAPE('Démarrer l’API et la vérifier', '5 min'),
  ...actions([
    'Dans cPanel, **Setup Node.js App**, ligne de l’application : **Start App** (icône ▶) ou **Restart**.',
    'Dans le navigateur, ouvrez `https://api.mondomaine.com/api/sante`.',
  ]),
  resultat(
    '`{"statut":"ok","service":"adil-gestventephone-api"}`. La documentation de l’API est aussi visible sur `https://api.mondomaine.com/api/docs`.',
  ),
  P(
    'Si le navigateur affiche **« Ce site est inaccessible »** (ou `DNS_PROBE_FINISHED_NXDOMAIN`), la demande n’atteint pas le serveur : l’API n’est pas en cause, et le journal n’existe pas encore (Passenger ne démarre l’API qu’à la première visite). Vérifiez l’adresse depuis PowerShell, sur le PC :',
  ),
  ...ps(`
Resolve-DnsName mondomaine.com -Server 1.1.1.1
Resolve-DnsName api.mondomaine.com -Server 1.1.1.1
`),
  ...tableau(
    ['Réponse', 'Cause et solution'],
    [
      [
        '`mondomaine.com : Le nom DNS n’existe pas`',
        'Le domaine lui-même n’existe pas sur Internet : faute de frappe (comparez avec cPanel › **Domaines**), ou enregistrement du domaine pas encore fait ou pas encore payé (espace client o2switch › **Domaines** : état « Actif » attendu ; compter quelques heures après la commande).',
      ],
      [
        'Le domaine répond, mais pas `api.mondomaine.com`',
        'Le sous-domaine manque : refaites l’étape 9. Si le domaine est géré ailleurs, ajoutez l’enregistrement A de l’étape 8. Attendez jusqu’à 1 heure.',
      ],
      [
        'Les deux répondent par l’adresse IP de cPanel (Informations générales)',
        'Les DNS sont bons : videz le cache (`ipconfig /flushdns`) ou essayez sur le téléphone en 4G ; vérifiez le certificat HTTPS (étape 10).',
      ],
    ],
    [3.5, 6.5],
  ),
  P(
    'Si la page affiche **« Not Found – The requested URL was not found on this server »** (et que `https://api.mondomaine.com/` montre une liste vide « Index of / »), l’API n’est pas reliée au sous-domaine : Passenger ne la lance pas, et `api.log` n’existe pas. C’est le cas si l’application de l’étape 17 a été créée avant le sous-domaine `api` (étape 9). Vérifiez en SSH :',
  ),
  ...ssh(`
cat ~/api.mondomaine.com/.htaccess
`),
  P(
    'Le fichier doit contenir `PassengerAppRoot "/home/IDENTIFIANT/gestvente/source/api"`. S’il est absent ou ne contient pas de lignes `Passenger` :',
  ),
  ...actions([
    'cPanel › **Setup Node.js App** › crayon de l’application.',
    '**Application URL** : choisissez `api.mondomaine.com` dans la liste et laissez **vide** la case du chemin à droite (n’y retapez pas le nom du domaine : l’API serait alors à l’adresse `https://api.mondomaine.com/api.mondomaine.com/`). Contrôle en SSH : `cloudlinux-selector get --json --interpreter nodejs` doit montrer `"app_uri": ""`. Vérifiez aussi **Application root** (`gestvente/source/api`), **Application startup file** (`passenger.cjs`) et **Passenger log file** (`/home/IDENTIFIANT/gestvente/journaux/api.log` ; s’il est vide, `"passenger_log_file": null`, aucun journal n’est écrit).',
    '**Save** puis **Restart**. Si l’outil refuse à cause de `node_modules`, suivez la ligne « Setup Node.js App refuse… » du Dépannage.',
    'Relancez `cat ~/api.mondomaine.com/.htaccess` : les lignes `Passenger…` sont là. Rechargez `/api/sante`.',
  ]),
  P(
    'Si une page d’erreur du serveur s’affiche (503, « Incomplete response »…), lisez le journal :',
  ),
  ...ssh(`
tail -n 50 ~/gestvente/journaux/api.log
`),
  P(
    'puis consultez le chapitre Dépannage (« 503 », « Incomplete response », « Cannot find module »…).',
  ),
  ...encadre('verif', [
    '**Fin de la partie C.** `https://api.mondomaine.com/api/sante` répond `"statut":"ok"`, le mot de passe du concepteur est dans le gestionnaire, le fichier `.env` est en `-rw-------`.',
  ]),
);

// ── PARTIE D ────────────────────────────────────────────────────────────────
ajouter(
  H1('13. Partie D — Installer le site web'),
  P(
    'Le site se construit sur **votre ordinateur** (c’est lourd, et le résultat est le même quel que soit le système), puis s’envoie sur le serveur.',
  ),
  ETAPE('Construire le site', '10 min'),
  ...ps(`
cd C:\\Users\\mamad\\Pictures\\github\\Adil-gestVentephone
git pull
pnpm install
pnpm --filter @gestvente/commun build
cd app
$env:EXPO_PUBLIC_API_URL = "https://api.mondomaine.com/api"
$env:CI = "1"
npx expo export --platform web --output-dir dist-web
dir dist-web
`),
  ...encadre('attention', [
    'Si PowerShell répond **« Impossible de charger le fichier …\npm\pnpm.ps1, car l’exécution de scripts est désactivée sur ce système »** (`PSSecurityException`), Windows bloque les scripts `.ps1` installés par npm. Deux solutions :',
    '• sans rien changer : tapez `pnpm.cmd` au lieu de `pnpm` et `npx.cmd` au lieu de `npx` dans les commandes ci-dessus ;',
    '• ou autorisez une fois pour toutes les scripts locaux pour votre compte : `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, répondez `O`, puis fermez et rouvrez PowerShell. Seuls les scripts téléchargés et non signés restent bloqués.',
  ]),
  resultat(
    '`Exported: dist-web` puis, dans le dossier : `index.html`, `_expo`, `assets`, `manifest.json`, `sw.js`, des icônes…',
  ),
  ...encadre(
    'danger',
    'L’adresse `EXPO_PUBLIC_API_URL` est **inscrite dans le site au moment de la construction**. Une erreur ici (oubli de `/api`, `http` au lieu de `https`) oblige à reconstruire et renvoyer le site.',
  ),
  ETAPE('Envoyer le site sur le serveur', '5 à 15 min'),
  P('**Méthode A (conseillée) — par SSH**, toujours dans PowerShell, dossier `app` :'),
  ...ps(`
ssh o2switch "rm -rf ~/app.mondomaine.com/_expo ~/app.mondomaine.com/assets"
scp -r dist-web/* o2switch:app.mondomaine.com/
`),
  resultat('la liste des fichiers envoyés défile, sans erreur.'),
  P('**Méthode B — par le Gestionnaire de fichiers de cPanel** :'),
  ...ps(`
Compress-Archive -Path dist-web\\* -DestinationPath ..\\site-web.zip -Force
`),
  ...actions([
    'cPanel › **Gestionnaire de fichiers** › dossier `app.mondomaine.com`. Supprimez les anciens fichiers **sauf** `.htaccess` (pour voir les fichiers cachés : **Paramètres** › **Afficher les fichiers cachés**).',
    '**Charger** › choisissez `site-web.zip` › attendez 100 % › **Retour**.',
    'Clic droit sur `site-web.zip` › **Extraire** › dossier `/app.mondomaine.com` › **Extraire les fichiers**. Supprimez ensuite le `.zip`.',
  ]),
  ETAPE('Créer le fichier .htaccess du site', '5 min'),
  P(
    'Ce fichier active la base locale de l’application (isolation de la page), le cache correct et la navigation. En SSH :',
  ),
  ...ssh(`
cat > ~/app.mondomaine.com/.htaccess <<'FIN'
# GestVente Phone : site installable (export web Expo)
Options -Indexes
DirectoryIndex index.html
AddType application/wasm .wasm

<IfModule mod_headers.c>
  # La base locale (SQLite WebAssembly) exige l'isolation de la page.
  Header always set Cross-Origin-Opener-Policy "same-origin"
  Header always set Cross-Origin-Embedder-Policy "credentialless"
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Strict-Transport-Security "max-age=31536000"
  <FilesMatch "^(index\\.html|sw\\.js|manifest\\.json)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>

RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
# Toute adresse de l'application renvoie index.html (navigation côté application).
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]
RewriteRule ^ index.html [L]
FIN
curl -sI https://app.mondomaine.com/ | grep -i "cross-origin"
`),
  resultat(
    'deux lignes : `cross-origin-opener-policy: same-origin` et `cross-origin-embedder-policy: credentialless`.',
  ),
  ETAPE('Ouvrir l’application', '5 min'),
  ...actions([
    'Dans Chrome ou Edge, ouvrez `https://app.mondomaine.com`.',
    'L’écran de connexion de GestVente Phone s’affiche, avec le lien **Espace concepteur** en bas.',
    'Touche **F12** › onglet **Console** : aucune erreur rouge mentionnant « CORS » ou « Cross-Origin ».',
  ]),
  resultat('l’écran de connexion, sans erreur. Si l’écran reste blanc, voir le Dépannage.'),
  ...encadre(
    'verif',
    '**Fin de la partie D.** L’application s’ouvre en HTTPS sur `app.mondomaine.com` et la console n’affiche pas d’erreur.',
  ),
);

// ── PARTIE E ────────────────────────────────────────────────────────────────
ajouter(
  H1('14. Partie E — Mettre en service'),
  H2('14.1 Tâches planifiées'),
  ETAPE('Préparer la sauvegarde chiffrée', '10 min'),
  P(
    'Fichier des paramètres (remplacez les valeurs ; `SAUVEGARDE_CLE` = second secret de l’étape 21) :',
  ),
  ...ssh(`
cat > ~/gestvente/scripts/sauvegarde.env <<'FIN'
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=IDENTIFIANT_gestvente
PGPASSWORD=MOT_DE_PASSE_PG
PGDATABASE=IDENTIFIANT_gestvente
SAUVEGARDE_CLE=SECOND_SECRET_DE_48_CARACTERES
SAUVEGARDE_JOURS=14
FIN
chmod 600 ~/gestvente/scripts/sauvegarde.env
nano ~/gestvente/scripts/sauvegarde.env
`),
  P(
    'Dans `nano`, remplacez les valeurs en MAJUSCULES, puis Ctrl+O, Entrée, Ctrl+X. Créez ensuite le script :',
  ),
  ...ssh(`
cat > ~/gestvente/scripts/sauvegarde.sh <<'FIN'
#!/bin/bash
# Sauvegarde chiffrée (AES-256) de la base et des fichiers de GestVente Phone.
set -euo pipefail
set -a; source "$HOME/gestvente/scripts/sauvegarde.env"; set +a
DOSSIER="$HOME/gestvente/sauvegardes"
HORODATAGE=$(date +%Y%m%d-%H%M%S)
TEMPORAIRE=$(mktemp -d)
trap 'rm -rf "$TEMPORAIRE"' EXIT

chiffrer() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \\
    -pass env:SAUVEGARDE_CLE -in "$1" -out "$2"
}

pg_dump --format=custom --no-owner -f "$TEMPORAIRE/base.dump"
chiffrer "$TEMPORAIRE/base.dump" "$DOSSIER/base-$HORODATAGE.dump.enc"
tar -C "$HOME/gestvente/stockage" -czf "$TEMPORAIRE/fichiers.tar.gz" .
chiffrer "$TEMPORAIRE/fichiers.tar.gz" "$DOSSIER/fichiers-$HORODATAGE.tar.gz.enc"
find "$DOSSIER" -name '*.enc' -mtime +"$SAUVEGARDE_JOURS" -delete
echo "$(date '+%F %T') sauvegarde $HORODATAGE terminée ($(du -sh "$DOSSIER" | cut -f1) au total)"
FIN
chmod 700 ~/gestvente/scripts/sauvegarde.sh
~/gestvente/scripts/sauvegarde.sh
ls -lh ~/gestvente/sauvegardes
`),
  resultat(
    '`… sauvegarde AAAAMMJJ-HHMMSS terminée`, puis deux fichiers `base-….dump.enc` et `fichiers-….tar.gz.enc`.',
  ),
  ETAPE('Programmer les tâches dans cPanel', '10 min'),
  ...actions([
    'cPanel › **Tâches Cron**. En haut, **Adresse e-mail de la tâche Cron** : votre adresse (vous recevrez les erreurs). **Mettre à jour l’adresse e-mail**.',
    '**Ajouter une nouvelle tâche Cron** : paramètre commun **Toutes les cinq minutes** (`*/5 * * * *`), commande ci-dessous (1), **Ajouter une nouvelle tâche Cron**.',
    'Nouvelle tâche : minute `30`, heure `2`, jour `*`, mois `*`, jour de la semaine `*`, commande (2).',
  ]),
  ...code(`
(1) curl -fsS -o /dev/null https://api.mondomaine.com/api/sante
(2) /home/IDENTIFIANT/gestvente/scripts/sauvegarde.sh >> /home/IDENTIFIANT/gestvente/journaux/sauvegarde.log 2>&1
`),
  resultat(
    'les deux tâches apparaissent dans **Tâches Cron actuelles**. Le lendemain matin, `tail -n 2 ~/gestvente/journaux/sauvegarde.log` montre la sauvegarde de la nuit.',
  ),
  ...encadre('info', [
    'La tâche (1) garde l’API éveillée : sans elle, Passenger l’arrête après quelques minutes sans visite et les rappels de crédit (9 h) et rapports (7 h) ne partent pas.',
    'L’horloge du serveur est à l’heure de Paris : 2 h 30 à Paris = 0 h 30 (été) ou 1 h 30 (hiver) à Conakry.',
  ]),
  H2('14.2 Premier commerce : Adil Phone'),
  ETAPE('Se connecter à l’espace concepteur', '2 min'),
  ...actions([
    'Ouvrez `https://app.mondomaine.com/plateforme` (ou le lien **Espace concepteur** sous la connexion).',
    'Identifiant et mot de passe du concepteur (étape 24).',
  ]),
  resultat(
    'l’écran **Espace concepteur** avec les boutons **Nouveau commerçant**, **Tableau de bord** et **Quitter**.',
  ),
  ETAPE('Créer le commerce Adil Phone et son propriétaire', '5 min'),
  ...actions([
    '**Nouveau commerçant**. Remplissez : nom du commerce (`Adil Phone`), téléphone au format international (`+224…`), nom de la première boutique (`Adil Phone Madina`), **préfixe des factures** (2 à 5 lettres, ex. `MAD`), adresse, nom du propriétaire, **identifiant** du propriétaire (ex. `adil`).',
    'Validez. Le **mot de passe provisoire du propriétaire** s’affiche **une seule fois** : rangez-le dans le gestionnaire et transmettez-le au propriétaire en main propre.',
    'Ouvrez la fiche du commerce créé. Carte **Abonnement** › **Corriger l’échéance** : **videz** le champ de date, puis **Enregistrer la date**.',
  ]),
  resultat(
    'la carte Abonnement affiche **Sans échéance** : Adil Phone n’est jamais coupé. (Les autres commerçants démarrent avec 30 jours d’essai gratuits.)',
  ),
  P(
    'Le catalogue de base (téléphones et accessoires courants en Guinée, avec prix en GNF) est installé automatiquement à la création du commerce. Quittez l’espace concepteur (**Quitter**).',
  ),
  ETAPE('Première connexion du propriétaire', '5 min'),
  ...actions([
    'Ouvrez `https://app.mondomaine.com`, connectez-vous avec l’identifiant du propriétaire et son mot de passe provisoire.',
    'Choisissez un **code PIN** de 4 à 6 chiffres (déverrouillage quotidien, même hors ligne), confirmez-le.',
    'Choisissez la boutique.',
  ]),
  resultat(
    'l’accueil « Bonjour … » avec les chiffres du jour et les tuiles (Ventes, Caisse, Stock…).',
  ),
  ...encadre(
    'info',
    'Il n’y a pas d’écran pour changer son propre mot de passe : le mot de passe provisoire reste celui du propriétaire. S’il est oublié ou divulgué, le concepteur en génère un nouveau (fiche du commerce › **Nouveau mot de passe du propriétaire**), ce qui ferme ses anciennes sessions.',
  ),
  ETAPE('Boutiques, employés et réglages', '20 min'),
  ...actions([
    'Tuile **Boutiques** : ajoutez les autres boutiques (nom, préfixe des factures, adresse, téléphone).',
    'Tuile **Équipe** : créez chaque employé (nom, identifiant, rôle **Gérant** ou **Vendeur**, boutiques). Le mot de passe provisoire s’affiche une fois : notez-le pour le remettre à l’employé.',
    'Vérifiez les prix du catalogue (tuile **Stock**) et saisissez les achats ou l’inventaire de départ.',
    'Tuile **Imprimante** (sur téléphone Android) : associez l’imprimante de reçus Bluetooth.',
    'Installez l’application sur chaque poste : Chrome ou Edge › icône **Installer** dans la barre d’adresse ; sur téléphone, menu › **Ajouter à l’écran d’accueil**.',
  ]),
  ETAPE('Vérifier l’adresse IP des connexions', '5 min'),
  ...actions([
    'Après quelques connexions (propriétaire, employés, depuis des réseaux différents si possible), ouvrez en propriétaire la tuile **Journal d’audit**.',
    'Regardez l’adresse IP des lignes « Connexion ».',
  ]),
  resultat('des adresses **publiques et variées** (celles de vos box ou téléphones).'),
  ...encadre(
    'attention',
    'Si toutes les adresses sont **vides** ou toutes `127.0.0.1`, la limitation des tentatives de connexion s’appliquerait à tout le monde à la fois : signalez-le au développeur **avant** d’ouvrir le service à d’autres commerçants (réglage de la confiance accordée au relais Passenger).',
  ),
  H2('14.3 Messages aux clients et application mobile'),
  ETAPE('Brancher l’envoi réel des SMS et de WhatsApp (facultatif)', '30 min'),
  P(
    'Tant que `SMS_FOURNISSEUR=journal`, aucun message ne part : les textes sont écrits dans `~/gestvente/journaux/api.log`. Pour envoyer réellement :',
  ),
  ...tableau(
    ['Canal', 'Variables du .env', 'Ce qu’il faut'],
    [
      [
        'SMS',
        '`SMS_FOURNISSEUR=http`\n`SMS_URL`, `SMS_CLE`\n`SMS_EXPEDITEUR`, `SMS_COUT`',
        'Une passerelle SMS (opérateur ou agrégateur) qui accepte un appel `POST SMS_URL` avec l’en-tête `Authorization: Bearer SMS_CLE` et le corps JSON `{ "to", "from", "text" }`.',
      ],
      [
        'WhatsApp',
        '`WHATSAPP_FOURNISSEUR=cloud`\n`WHATSAPP_JETON`\n`WHATSAPP_NUMERO_ID`, `WHATSAPP_COUT`',
        'Un compte WhatsApp Business Cloud (Meta) et quatre modèles approuvés : `gestvente_facture`, `gestvente_recu`, `gestvente_rappel_echeance`, `gestvente_retard_echeance`.',
      ],
    ],
    [1.5, 3.5, 5],
  ),
  ...actions([
    'Modifiez le fichier : `nano ~/gestvente/source/api/.env`, enregistrez.',
    'Redémarrez l’API : `touch ~/gestvente/source/api/tmp/restart.txt` (créez d’abord le dossier : `mkdir -p ~/gestvente/source/api/tmp`).',
    'Faites une vente test avec un client dont le numéro est le vôtre, choisissez **Par SMS** : vous devez recevoir le lien de la facture.',
  ]),
  ETAPE('Application mobile Android / iOS (facultatif)', 'variable'),
  P(
    'Les versions natives se construisent avec Expo (EAS). La seule différence avec le site : définir `EXPO_PUBLIC_API_URL=https://api.mondomaine.com/api` dans le profil de construction de production avant de lancer la construction.',
  ),
  ...encadre('verif', [
    '**Fin de l’installation.** Les deux tâches Cron sont programmées et une première sauvegarde existe ; Adil Phone est créé **sans échéance** ; le propriétaire et les employés se connectent ; les adresses IP du journal sont correctes. Copiez maintenant une sauvegarde sur votre ordinateur (chapitre 17.3).',
  ]),
);

// ── PARTIE F ────────────────────────────────────────────────────────────────
ajouter(
  H1('15. Partie F — Administrer au quotidien'),
  H2('15.1 Calendrier des contrôles'),
  ...tableau(
    ['Quand', 'Quoi', 'Comment'],
    [
      ['Chaque semaine', 'L’API répond', 'Ouvrir `https://api.mondomaine.com/api/sante`'],
      [
        'Chaque semaine',
        'La sauvegarde de la nuit existe',
        '`tail -n 3 ~/gestvente/journaux/sauvegarde.log`',
      ],
      ['Chaque semaine', 'Pas d’erreurs répétées', '`grep -ic error ~/gestvente/journaux/api.log`'],
      ['Chaque mois', 'Copier une sauvegarde hors du serveur', 'Chapitre 17.3'],
      [
        'Chaque mois',
        'Ressources et espace disque',
        'cPanel › **Utilisation des ressources** ; `du -sh ~/gestvente/*`',
      ],
      ['Chaque mois', 'Abonnements des commerçants', 'Espace concepteur › **Tableau de bord**'],
      ['Chaque trimestre', 'Tester une restauration', 'Chapitre 17.4, sur une base de test'],
      [
        'Chaque année',
        'Jeton GitHub, offre o2switch, nom de domaine',
        'Renouveler avant expiration (dates dans la fiche)',
      ],
    ],
    [2.2, 3.6, 4.2],
  ),
  H2('15.2 Lire les journaux'),
  ...ssh(`
tail -n 100 ~/gestvente/journaux/api.log        # dernières lignes du journal de l'API
tail -f ~/gestvente/journaux/api.log            # suivi en direct (Ctrl+C pour quitter)
grep -i "error" ~/gestvente/journaux/api.log | tail -n 20
`),
  H2('15.3 Redémarrer l’API'),
  ...puces([
    'cPanel › **Setup Node.js App** › **Restart** sur la ligne de l’application ;',
    'ou en SSH : `mkdir -p ~/gestvente/source/api/tmp && touch ~/gestvente/source/api/tmp/restart.txt` (redémarrage à la requête suivante).',
  ]),
  P('Un redémarrage est nécessaire après une mise à jour ou une modification du `.env`.'),
  H2('15.4 Administrer la plateforme (concepteur)'),
  ...tableau(
    ['Besoin', 'Où, dans l’espace concepteur'],
    [
      [
        'Voir les commerces en essai, abonnés, à renouveler, échus ; l’encaissé du mois et de l’année',
        '**Tableau de bord**',
      ],
      ['Ouvrir un nouveau commerce (30 jours d’essai)', '**Nouveau commerçant**'],
      [
        'Enregistrer un paiement (150 000 GNF/mois + 50 000 GNF par boutique supplémentaire ; l’année = 10 mois)',
        'Fiche du commerce › **Abonnement** › **Enregistrer le paiement**',
      ],
      [
        'Corriger une échéance, ou mettre un commerce sans échéance',
        'Fiche › **Corriger l’échéance**',
      ],
      ['Suspendre ou réactiver un commerce', 'Fiche › **Accès du commerce**'],
      ['Verrouiller, supprimer ou restaurer une boutique', 'Fiche › **Boutiques**'],
      ['Mot de passe du propriétaire oublié', 'Fiche › **Nouveau mot de passe du propriétaire**'],
    ],
    [6, 4],
  ),
  P(
    'Après l’échéance, l’accès reste ouvert 7 jours (avertissement au propriétaire), puis il est coupé : plus de connexion ni de synchronisation, données conservées. Un paiement rouvre l’accès immédiatement.',
  ),
);

ajouter(
  H1('16. Mettre à jour l’application'),
  ETAPE('Créer le script de mise à jour de l’API (une seule fois)', '5 min'),
  ...ssh(`
cat > ~/gestvente/scripts/mettre-a-jour.sh <<'FIN'
#!/bin/bash
# Mise à jour de l'API : sauvegarde, code, construction, migrations, redémarrage.
set -euo pipefail
source /home/IDENTIFIANT/nodevenv/gestvente/source/api/24/bin/activate
echo "1/5 Sauvegarde avant mise à jour"
"$HOME/gestvente/scripts/sauvegarde.sh"
echo "2/5 Récupération du code"
cd "$HOME/gestvente/source"
git pull --ff-only
echo "3/5 Dépendances et construction"
if [ -L api/node_modules ]; then rm api/node_modules; fi
NODE_ENV=development pnpm install --frozen-lockfile --filter "@gestvente/api..."
pnpm --filter @gestvente/commun build
pnpm --filter @gestvente/api exec prisma generate
pnpm --filter @gestvente/api build
echo "4/5 Migrations de la base"
cd api
pnpm exec prisma migrate deploy
echo "5/5 Redémarrage"
mkdir -p tmp && touch tmp/restart.txt
sleep 5
curl -fsS https://api.mondomaine.com/api/sante && echo " : API en service"
FIN
chmod 700 ~/gestvente/scripts/mettre-a-jour.sh
nano ~/gestvente/scripts/mettre-a-jour.sh
`),
  P(
    'Dans `nano`, remplacez `IDENTIFIANT` (ligne `source`) par votre commande d’activation exacte et `mondomaine.com` (dernière ligne), puis Ctrl+O, Entrée, Ctrl+X.',
  ),
  H2('16.1 À chaque nouvelle version'),
  ...actions([
    'Prévenez les boutiques et choisissez un moment **hors heures d’ouverture**. Les appareils continuent hors ligne pendant l’opération : rien n’est perdu.',
    'Mettez à jour l’**API** :',
  ]),
  ...ssh(`
~/gestvente/scripts/mettre-a-jour.sh
`),
  resultat('les étapes 1/5 à 5/5 défilent et la dernière ligne indique `: API en service`.'),
  ...actions([
    'Si la version modifie des écrans, reconstruisez et renvoyez le **site** (étapes 26 et 27), **après** l’API. Ne touchez pas au `.htaccess`.',
    'Ouvrez l’application, vérifiez une vente test, puis prévenez les boutiques. Les postes reçoivent la nouvelle version en rouvrant l’application.',
  ]),
  H2('16.2 Revenir à la version précédente'),
  ...ssh(`
${ACTIVER}
cd ~/gestvente/source
git log --oneline -5              # repérer la version précédente (7 caractères)
git checkout IDENTIFIANT_VERSION
if [ -L api/node_modules ]; then rm api/node_modules; fi
NODE_ENV=development pnpm install --frozen-lockfile --filter "@gestvente/api..."
pnpm --filter @gestvente/commun build
pnpm --filter @gestvente/api exec prisma generate
pnpm --filter @gestvente/api build
touch api/tmp/restart.txt
`),
  P(
    'Plus tard, pour revenir à la version courante : `git checkout main` puis le script de mise à jour. Si la mise à jour avait modifié la base (migrations), restaurez la sauvegarde faite au début du script (chapitre 17.4).',
  ),
);

ajouter(
  H1('17. Sauvegardes et restauration'),
  H2('17.1 Trois niveaux de protection'),
  ...tableau(
    ['Niveau', 'Contenu', 'Où'],
    [
      [
        'Sauvegardes o2switch (JetBackup)',
        'Tout l’hébergement, chaque jour, plusieurs jours de rétention',
        'cPanel › **JetBackup**',
      ],
      [
        'Sauvegardes GestVente',
        'Base + fichiers, chiffrés, chaque nuit, 14 jours',
        '`~/gestvente/sauvegardes`',
      ],
      [
        'Copie hors serveur',
        'Au moins une sauvegarde GestVente par mois',
        'Ordinateur + disque externe ou cloud',
      ],
    ],
    [3, 4.2, 2.8],
  ),
  H2('17.2 Sauvegarde immédiate'),
  ...ssh(`
~/gestvente/scripts/sauvegarde.sh
`),
  H2('17.3 Copier les sauvegardes sur l’ordinateur'),
  ...ps(`
mkdir C:\\Sauvegardes\\GestVente -Force
scp "o2switch:gestvente/sauvegardes/*.enc" C:\\Sauvegardes\\GestVente\\
dir C:\\Sauvegardes\\GestVente
`),
  P(
    'Les fichiers sont chiffrés : ils peuvent aller sur un disque externe ou un cloud sans risque, tant que `SAUVEGARDE_CLE` reste secrète.',
  ),
  H2('17.4 Restaurer'),
  ...encadre(
    'danger',
    'Une restauration **remplace** toutes les données actuelles. Les ventes faites depuis la sauvegarde seront perdues côté serveur. Faites d’abord une sauvegarde immédiate de l’état actuel.',
  ),
  ...actions([
    'Arrêtez l’API : cPanel › **Setup Node.js App** › **Stop App**.',
    'Repérez la sauvegarde voulue : `ls -lh ~/gestvente/sauvegardes`.',
    'Restaurez la base (remplacez la date et l’heure) :',
  ]),
  ...ssh(`
set -a; source ~/gestvente/scripts/sauvegarde.env; set +a
cd ~/gestvente/sauvegardes
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:SAUVEGARDE_CLE \\
  -in base-20261127-023000.dump.enc -out ~/base.dump
pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" ~/base.dump
rm ~/base.dump
`),
  P('Restaurez les fichiers (photos, justificatifs) si nécessaire :'),
  ...ssh(`
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:SAUVEGARDE_CLE \\
  -in fichiers-20261127-023000.tar.gz.enc -out ~/fichiers.tar.gz
tar -C ~/gestvente/stockage -xzf ~/fichiers.tar.gz
rm ~/fichiers.tar.gz
`),
  ...actions([
    'Redémarrez l’API (**Start App**) et vérifiez `/api/sante`.',
    'Sur chaque appareil : tuile **Synchronisation**. En cas d’incohérence, déconnectez puis reconnectez l’appareil pour recharger les données du serveur.',
  ]),
);

ajouter(
  H1('18. Sécurité'),
  ...tableau(
    ['Mesure', 'Pourquoi'],
    [
      [
        'Double authentification sur cPanel et l’espace client',
        'Le compte cPanel donne accès à toutes les données.',
      ],
      [
        'Clé SSH avec phrase de passe ; autorisations IP tenues à jour',
        'Limite l’accès au terminal du serveur.',
      ],
      [
        '`.env` et `sauvegarde.env` en 600 ; `stockage`, `sauvegardes`, `scripts` en 700',
        'Seul votre compte lit les secrets et les fichiers.',
      ],
      ['Code hors de `public_html`', 'Rien de l’API n’est téléchargeable.'],
      [
        'Jeton GitHub en lecture seule, limité au dépôt, 1 an',
        'Un vol du jeton ne permet pas de modifier le code.',
      ],
      ['HTTPS forcé sur les deux sous-domaines', 'Mots de passe et données chiffrés en transit.'],
      [
        'Mots de passe provisoires remis en main propre, jamais par SMS public ou groupe',
        'Le mot de passe reste celui de l’utilisateur.',
      ],
      [
        'Sauvegardes chiffrées et copiées hors serveur',
        'Protège de la perte du serveur et de la fuite des copies.',
      ],
      ['Mises à jour régulières', 'Correctifs de sécurité.'],
    ],
    [5, 5],
  ),
  H2('18.1 Incidents'),
  ...tableau(
    ['Situation', 'Que faire'],
    [
      [
        'Téléphone ou PC d’un employé perdu, volé',
        'Propriétaire › **Appareils connectés** › déconnecter l’appareil. Sans le code PIN, la base locale est inutilisable.',
      ],
      ['Employé qui quitte l’entreprise', 'Propriétaire › **Équipe** › désactiver le compte.'],
      [
        'Mot de passe d’un employé divulgué',
        'Propriétaire › **Équipe** › nouveau mot de passe provisoire.',
      ],
      [
        'Mot de passe du propriétaire divulgué',
        'Concepteur › fiche du commerce › **Nouveau mot de passe du propriétaire**.',
      ],
      [
        'Doute sur la sécurité du serveur',
        'Changer le mot de passe cPanel ; le mot de passe PostgreSQL (cPanel, puis `.env` et `sauvegarde.env`) ; `JWT_SECRET` (tous les appareils devront se reconnecter) ; révoquer le jeton GitHub ; redémarrer l’API.',
      ],
    ],
    [3.5, 6.5],
  ),
);

ajouter(
  H1('19. Dépannage'),
  ...tableau(
    ['Symptôme', 'Cause probable', 'Solution'],
    [
      [
        'SSH : « Connection timed out »',
        'Adresse IP non autorisée (elle a changé)',
        'Ajouter l’IP actuelle dans **Autorisation SSH**, attendre 5 minutes.',
      ],
      [
        '`prisma: command not found` puis `ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED` pendant `pnpm install`',
        '`api/node_modules` est encore le lien créé par Setup Node.js App, ou le préfixe `NODE_ENV=development` manque',
        'Retaper les deux lignes de l’étape 19 : `if [ -L api/node_modules ]; then rm api/node_modules; fi` puis `NODE_ENV=development pnpm install …`. `ls -ld api/node_modules` doit commencer par `d`.',
      ],
      [
        '`redis-cli: command not found`',
        '`redis-cli` n’est pas installé pour les comptes o2switch',
        'Utiliser le test de l’étape 13 (`exec 3<>/dev/tcp/…`), qui doit afficher `+OK` puis `+PONG`.',
      ],
      [
        'SSH : « Could not resolve hostname o2switch »',
        'Le raccourci `.ssh\\config` n’est pas lu (fichier `config.txt`, mauvais dossier) ou la commande est tapée dans le Terminal de cPanel',
        'Recréer le fichier avec la commande de l’étape 7 ; `ssh -G o2switch` doit afficher le nom du serveur. Taper `ssh o2switch` dans PowerShell, sur le PC.',
      ],
      [
        'SSH : « Could not resolve hostname mondomaine.com »',
        'Domaine pas encore relié à l’hébergement',
        'Dans `.ssh\\config`, `HostName` = nom du serveur o2switch (`xxxxx.o2switch.net`).',
      ],
      [
        'SSH : « Permission denied (publickey) »',
        'Clé non autorisée ou mauvais fichier',
        'cPanel › Accès SSH › la clé doit être **autorisée** ; vérifier `IdentityFile` dans `.ssh\\config`.',
      ],
      [
        '`node` ou `pnpm` : « command not found »',
        'Node.js non activé dans cette session',
        'Taper la commande `source …/bin/activate` (fiche).',
      ],
      [
        '`/api/sante` : erreur 503 ou « Incomplete response »',
        'API arrêtée ou erreur au démarrage',
        '`tail -n 50 ~/gestvente/journaux/api.log` ; vérifier `.env` et `api/dist/main.js` ; **Restart**.',
      ],
      [
        'Journal : « Cannot find module … dist/main.js »',
        'API non construite',
        'Refaire l’étape 20 (construction).',
      ],
      [
        'Journal : « ERR_REQUIRE_ESM » ou erreur sur `import`',
        'Mauvais fichier de démarrage',
        'Champ **Application startup file** = `passenger.cjs` (étapes 16 et 17).',
      ],
      [
        'Journal : « DATABASE_URL » ou « REDIS_URL » manquant',
        '`.env` absent ou mal placé',
        'Il doit être `~/gestvente/source/api/.env`.',
      ],
      [
        '« password authentication failed »',
        'Mot de passe ou hôte PostgreSQL',
        '`127.0.0.1` ; mot de passe sans symbole ; utilisateur ajouté à la base avec tous les privilèges.',
      ],
      [
        'Journal : « NOAUTH » ou « ECONNREFUSED » (Redis)',
        'Instance arrêtée ou mot de passe faux',
        'Outil **Redis** : état, relancer ; recopier port et mot de passe dans `REDIS_URL`.',
      ],
      [
        'Site : « Erreur réseau », « CORS » en console',
        '`APP_ORIGIN` différent de l’adresse du site',
        '`APP_ORIGIN=https://app.mondomaine.com` sans barre finale ; redémarrer l’API.',
      ],
      [
        'Site : l’application appelle localhost',
        'Site construit sans `EXPO_PUBLIC_API_URL`',
        'Reconstruire (étape 26) puis renvoyer (étape 27).',
      ],
      [
        'Site : page blanche, base locale impossible',
        'En-têtes COOP/COEP absents ou pas de HTTPS',
        'Vérifier le `.htaccess` (étape 28) et le certificat ; Ctrl+F5.',
      ],
      [
        'API : « Not Found », `/` affiche « Index of / », `api.log` absent',
        'Application Node.js pas reliée au sous-domaine `api` (pas de lignes `Passenger` dans `~/api.mondomaine.com/.htaccess`)',
        'Setup Node.js App › crayon › **Application URL** = `api.mondomaine.com` › **Save** › **Restart** (étape 25).',
      ],
      [
        'Site : 404 en rechargeant une page',
        'Règles de réécriture absentes',
        'Fin du `.htaccess` (renvoi vers `index.html`).',
      ],
      [
        'Setup Node.js App refuse d’enregistrer une modification à cause de `node_modules`',
        'L’outil veut un lien `node_modules` vers `~/nodevenv`, or pnpm a besoin d’un vrai dossier',
        'Ne jamais utiliser **Run NPM Install**. Pour modifier l’application : `mv api/node_modules api/node_modules.pnpm`, faire la modification dans cPanel, puis `rm -f api/node_modules` et `mv api/node_modules.pnpm api/node_modules`, et enfin `touch api/tmp/restart.txt`.',
      ],
      [
        '« out of memory », « fork failed »',
        'Terminal cPanel limité ou mémoire',
        'Vrai SSH ; `export NODE_OPTIONS=--max-old-space-size=2048`.',
      ],
      [
        'Rappels de crédit absents à 9 h',
        'API en veille',
        'Vérifier la tâche Cron (1) toutes les 5 minutes.',
      ],
      [
        'Commerçant : « L’abonnement … a pris fin »',
        'Échéance + 7 jours dépassés',
        'Enregistrer le paiement dans l’espace concepteur.',
      ],
      [
        'Navigateur : « Ce site est inaccessible » et `api.log` absent',
        'Le domaine ou le sous-domaine n’existe pas dans les DNS (faute de frappe, domaine pas encore enregistré, sous-domaine manquant)',
        'Suivre le tableau de l’étape 25 (`Resolve-DnsName` depuis le PC).',
      ],
      [
        '`P1000: Authentication failed … (not available)`',
        'Ligne `DATABASE_URL` du `.env` fausse (utilisateur absent ou mal écrit, mot de passe différent de cPanel)',
        'Suivre le tableau de l’étape 23 (affichage masqué de la ligne et test `psql`).',
      ],
      [
        '`prisma migrate deploy` échoue',
        'Connexion à la base ou conflit',
        'Lire le message ; ne jamais modifier une migration ; restaurer la sauvegarde d’avant mise à jour si besoin.',
      ],
      [
        '`git pull` demande un mot de passe',
        'Jeton GitHub expiré',
        'Nouveau jeton (étape 14), `rm ~/.git-credentials`, puis `git pull` avec le nouveau jeton.',
      ],
    ],
    [3, 3, 4],
  ),
  H2('19.1 Contacter le support o2switch'),
  P(
    'Support en français, 24 h/24, par ticket depuis l’espace client ou par téléphone. Donnez : identifiant cPanel, sous-domaine concerné, heure du problème, message d’erreur exact. Le support gère l’hébergement (Node.js, PostgreSQL, Redis, pare-feu), pas le code de l’application.',
  ),
);

ajouter(
  H1('20. Limites et plan d’évolution'),
  H2('20.1 Quand passer à un serveur privé (VPS)'),
  ...puces([
    'o2switch annonce l’arrêt de PostgreSQL sur ses offres mutualisées ;',
    'plusieurs dizaines de commerces abonnés, ou des lenteurs alors que les ressources sont disponibles ;',
    'besoin d’un Redis permanent ou d’une version récente de PostgreSQL.',
  ]),
  P(
    'Le projet contient déjà tout le nécessaire : `docker-compose.prod.yml` (Caddy avec HTTPS automatique, API, site, PostgreSQL 17, Redis permanent, sauvegarde chiffrée) et le guide `docs/DEPLOIEMENT.md`.',
  ),
  H2('20.2 Déménager'),
  ...actions([
    'Sauvegarde immédiate sur o2switch (17.2) et copie sur l’ordinateur (17.3).',
    'Installer le nouveau serveur, restaurer la base (`pg_restore`) et les fichiers.',
    'Reprendre le même `JWT_SECRET` : les appareils restent connectés.',
    'Faire pointer `api.mondomaine.com` et `app.mondomaine.com` vers le nouveau serveur (DNS).',
  ]),
  H2('20.3 Variante : base récente hébergée ailleurs'),
  P(
    'L’API peut rester chez o2switch et utiliser une base PostgreSQL récente d’un fournisseur spécialisé (région Europe) : remplacer `DATABASE_URL` (avec `sslmode=require`), restaurer la sauvegarde dans cette base, mettre à jour `sauvegarde.env`, redémarrer l’API.',
  ),
);

// ── Annexes ─────────────────────────────────────────────────────────────────
ajouter(
  H1('Annexe A. Liste de contrôle de l’installation'),
  ...tableau(
    ['✓', 'Contrôle', 'Étape'],
    [
      ['☐', 'Logiciels du PC vérifiés, projet à jour, gestionnaire de mots de passe prêt', '1 à 3'],
      ['☐', 'cPanel en français, mot de passe changé, double authentification active', '4'],
      ['☐', 'IP autorisée, clé SSH importée et autorisée, `ssh o2switch` fonctionne', '5 à 7'],
      ['☐', 'Domaine relié, sous-domaines `app` et `api` créés, HTTPS actif et forcé', '8 à 10'],
      ['☐', 'Base et utilisateur PostgreSQL, `select version()` → 9.6', '11, 12'],
      ['☐', 'Redis démarré, `PONG`', '13'],
      ['☐', 'Jeton GitHub, code cloné, `git pull` sans mot de passe', '14, 15'],
      [
        '☐',
        '`passenger.cjs` créé, application Node.js déclarée, commande « source » notée',
        '16, 17',
      ],
      ['☐', 'pnpm installé, dépendances installées, `api/dist/main.js` présent', '18 à 20'],
      ['☐', 'Secrets générés et rangés, `.env` complet en 600', '21, 22'],
      ['☐', 'Migrations appliquées, concepteur créé', '23, 24'],
      ['☐', '`/api/sante` répond `"statut":"ok"`', '25'],
      [
        '☐',
        'Site construit et envoyé, `.htaccess` en place, écran de connexion sans erreur',
        '26 à 29',
      ],
      ['☐', 'Sauvegarde testée, tâches Cron programmées', '30, 31'],
      ['☐', 'Adil Phone créé sans échéance, propriétaire connecté avec son PIN', '32 à 34'],
      ['☐', 'Boutiques, employés, imprimante, installation sur les postes', '35'],
      ['☐', 'Adresses IP du journal vérifiées', '36'],
      ['☐', 'Première sauvegarde copiée sur l’ordinateur', '17.3'],
    ],
    [0.6, 7.2, 2.2],
  ),
  H1('Annexe B. Récapitulatif des commandes'),
  ...tableau(
    ['Besoin', 'Commande'],
    [
      ['Se connecter au serveur', '`ssh o2switch`'],
      ['Activer Node.js', `\`${ACTIVER}\``],
      ['Mettre à jour l’API', '`~/gestvente/scripts/mettre-a-jour.sh`'],
      ['Redémarrer l’API', '`touch ~/gestvente/source/api/tmp/restart.txt`'],
      ['Journal de l’API', '`tail -n 100 ~/gestvente/journaux/api.log`'],
      ['Sauvegarde immédiate', '`~/gestvente/scripts/sauvegarde.sh`'],
      ['Liste des sauvegardes', '`ls -lh ~/gestvente/sauvegardes`'],
      [
        'Copier les sauvegardes (PowerShell)',
        '`scp "o2switch:gestvente/sauvegardes/*.enc" C:\\Sauvegardes\\GestVente\\`',
      ],
      ['État de l’API', '`curl https://api.mondomaine.com/api/sante`'],
      ['Migrations en attente', '`cd ~/gestvente/source/api && pnpm exec prisma migrate status`'],
      ['Place occupée', '`du -sh ~/gestvente/*`'],
    ],
    [3.2, 6.8],
  ),
  H1('Annexe C. Glossaire'),
  ...tableau(
    ['Terme', 'Signification'],
    [
      [
        'API',
        'Le programme serveur de GestVente : il reçoit les demandes de l’application et lit / écrit la base.',
      ],
      ['cPanel', 'L’interface d’administration de l’hébergement o2switch.'],
      ['SSH', 'Connexion sécurisée à un terminal sur le serveur.'],
      [
        'Clé SSH',
        'Paire de fichiers (publique / privée) qui remplace le mot de passe pour le SSH.',
      ],
      ['Passenger', 'Le logiciel d’o2switch qui lance l’API Node.js et la relie au sous-domaine.'],
      ['PostgreSQL', 'La base de données de l’application.'],
      ['Redis', 'Mémoire rapide pour les files d’envoi et les tâches planifiées.'],
      [
        'Migration',
        'Modification de la structure de la base, appliquée par `prisma migrate deploy`.',
      ],
      ['Cron', 'Tâche lancée automatiquement à heure fixe.'],
      ['`.env`', 'Fichier des réglages secrets de l’API.'],
      ['`.htaccess`', 'Fichier de réglages du serveur web pour le site.'],
      ['Concepteur', 'Administrateur de la plateforme (crée les commerces, gère les abonnements).'],
      [
        'Code PIN',
        'Code à 4–6 chiffres qui déverrouille l’application sur un appareil, même hors ligne.',
      ],
    ],
    [2.5, 7.5],
  ),
  H1('Annexe D. Sources'),
  ...puces([
    'FAQ o2switch — Déployer une application NodeJS : faq.o2switch.fr/cpanel/logiciels/hebergement-nodejs-multi-version/',
    'FAQ o2switch — Bases de données PostgreSQL (version 9.6, page du 2 mai 2025) : faq.o2switch.fr/cpanel/bases-de-donnees/postgresql/',
    'FAQ o2switch — Instance privée de Redis : faq.o2switch.fr/cpanel/o2switch/redis/',
    'FAQ o2switch — Autorisation SSH : faq.o2switch.fr/cpanel/outils/exception-parefeu/',
    'Prisma 7 — bases prises en charge (PostgreSQL 9.6 à 18) : prisma.io/docs/orm/v7/reference/supported-databases',
    'Projet — `docs/DEPLOIEMENT.md`, `docker-compose.prod.yml`, `deploy/`.',
  ]),
);

// ─── Document ───────────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'GestVente Phone',
  title: 'Guide de déploiement et d’administration — o2switch',
  description:
    'Installation pas à pas et administration de GestVente Phone sur o2switch (Offre Cloud)',
  styles: {
    default: { document: { run: { font: POLICE, size: 22 } } },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 34, bold: true, color: BLEU, font: POLICE },
        paragraph: {
          spacing: { before: 120, after: 240 },
          outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLEU, space: 4 } },
        },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 27, bold: true, color: '2F4A8A', font: POLICE },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1, keepNext: true },
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 24, bold: true, color: '1F3A93', font: POLICE },
        paragraph: {
          spacing: { before: 300, after: 100 },
          outlineLevel: 2,
          keepNext: true,
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF1FA' },
        },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'puces',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 540, hanging: 270 } } },
          },
        ],
      },
      {
        reference: 'etapes',
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 540, hanging: 360 } },
              run: { bold: true, color: BLEU },
            },
          },
        ],
      },
    ],
  },
  features: { updateFields: true },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 },
        },
        titlePage: true,
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: 'GestVente Phone — Déploiement et administration sur o2switch',
                  size: 16,
                  color: '888888',
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Page ', size: 16, color: '888888' }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' }),
                new TextRun({ text: ' sur ', size: 16, color: '888888' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '888888' }),
              ],
            }),
          ],
        }),
      },
      children: c,
    },
  ],
});

Packer.toBuffer(doc).then((tampon) => {
  fs.writeFileSync(SORTIE, tampon);
  console.log(`${numeroEtape} étapes — écrit : ${SORTIE} (${Math.round(tampon.length / 1024)} Ko)`);
});
