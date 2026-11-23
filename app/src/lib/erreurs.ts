/**
 * Messages d'erreur pour les utilisateurs : une phrase simple en français, jamais de code,
 * de numéro d'erreur ni de texte technique en anglais.
 */

export const MESSAGES = {
  reseau: 'Pas de connexion Internet. Vérifiez le réseau, puis réessayez.',
  baseLocale:
    'Les données de l’appareil n’ont pas pu s’ouvrir. Fermez les autres onglets de l’application, puis rouvrez-la.',
  saisie: 'Certaines informations saisies ne sont pas valides. Vérifiez les champs.',
  session: 'Votre session a expiré. Reconnectez-vous.',
  interdit: 'Vous n’avez pas le droit de faire cette action.',
  introuvable: 'Cet élément est introuvable. Il a peut-être été supprimé.',
  conflit: 'Cette information a déjà été modifiée ailleurs. Rechargez puis recommencez.',
  fichier: 'Le fichier est trop lourd.',
  tentatives: 'Trop de tentatives. Patientez quelques minutes, puis réessayez.',
  serveur: 'Le serveur a un problème. Réessayez dans un moment.',
  inattendue:
    'Une erreur inattendue est survenue. Réessayez ; si elle revient, contactez l’assistance.',
} as const;

/** Problèmes de la base locale du navigateur (SQLite WebAssembly, stockage de fichiers). */
const BASE_LOCALE =
  /wasm|webassembly|vfs|access ?handle|createsyncaccesshandle|opfs|sqlite|indexeddb|nomodificationallowed|quotaexceeded|aborted\(/i;
/** Coupures réseau, quel que soit le navigateur ou le téléphone. */
const RESEAU =
  /failed to fetch|network ?(error|request)|networkerror|load failed|net::|timed? ?out|econn|enotfound|internet|injoignable|offline/i;
/** Texte technique ou en anglais : à ne jamais montrer tel quel. */
const TECHNIQUE =
  /\b(error|failed|failure|must be|should be|cannot|can't|invalid|unexpected|undefined|null|is not|exception|typeerror|syntaxerror|referenceerror|json|token|status|request|response|property|object|function|forbidden|unauthorized|not found|bad request|internal server)\b|erreur \d{3}|^\s*\d{3}\b|[{}<>]|\w+Error\b/i;

/** Mots anglais courants : un message en anglais n'est jamais montré tel quel. */
const ANGLAIS =
  /\b(the|of|and|is|are|was|to|for|with|too|many|not|no|please|try|again|requests?)\b/i;

/** Message par code HTTP, quand le serveur n'a pas donné de phrase utilisable. */
export function messageStatut(statut: number): string {
  if (statut === 400 || statut === 422) return MESSAGES.saisie;
  if (statut === 401) return MESSAGES.session;
  if (statut === 403) return MESSAGES.interdit;
  if (statut === 404) return MESSAGES.introuvable;
  if (statut === 409) return MESSAGES.conflit;
  if (statut === 413) return MESSAGES.fichier;
  if (statut === 429) return MESSAGES.tentatives;
  if (statut >= 500) return MESSAGES.serveur;
  return MESSAGES.inattendue;
}

/**
 * Rend un texte affichable : une phrase française est gardée, un texte technique
 * (anglais, code, numéro d'erreur) est remplacé par une phrase simple.
 */
export function texteClair(texte: string | null | undefined): string {
  const t = (texte ?? '').trim();
  if (!t) return MESSAGES.inattendue;
  if (BASE_LOCALE.test(t)) return MESSAGES.baseLocale;
  if (RESEAU.test(t)) return MESSAGES.reseau;
  if (TECHNIQUE.test(t) || ANGLAIS.test(t)) return MESSAGES.inattendue;
  return t;
}

/** Message d'une erreur quelconque (exception, erreur de l'API, texte). */
export function messageClair(erreur: unknown): string {
  if (erreur && typeof erreur === 'object' && 'statut' in erreur) {
    const statut = Number((erreur as { statut: unknown }).statut);
    const message = (erreur as { message?: string }).message ?? '';
    const clair = texteClair(message);
    // Phrase du serveur en français : gardée ; sinon, phrase selon le code.
    return clair === MESSAGES.inattendue ? messageStatut(statut) : clair;
  }
  if (erreur instanceof Error) return texteClair(erreur.message);
  if (typeof erreur === 'string') return texteClair(erreur);
  return MESSAGES.inattendue;
}
