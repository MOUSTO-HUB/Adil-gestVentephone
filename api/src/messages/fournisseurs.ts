import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { TypeMessage } from '@gestvente/commun';

/**
 * Fournisseurs d'envoi, derrière des interfaces : les modules métier passent
 * toujours par MessagesService, jamais par un fournisseur.
 */

export interface ResultatEnvoi {
  reference: string;
  /** Coût de l'envoi, dans la monnaie du commerce (estimation de la configuration). */
  cout: number;
}

export interface SmsSender {
  envoyer(numero: string, texte: string): Promise<ResultatEnvoi>;
}

export interface WhatsAppSender {
  /** Faux si aucun compte WhatsApp Business n'est configuré : les messages partent en SMS. */
  readonly disponible: boolean;
  /** Envoi d'un modèle approuvé par Meta, avec ses paramètres dans l'ordre. */
  envoyerModele(numero: string, type: TypeMessage, parametres: string[]): Promise<ResultatEnvoi>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');
export const WHATSAPP_SENDER = Symbol('WHATSAPP_SENDER');

/**
 * Numéros dont l'envoi échoue avec les fournisseurs « journal » (essais de la bascule) :
 * MESSAGES_ECHEC_SMS et MESSAGES_ECHEC_WHATSAPP, séparés par des virgules.
 */
const echecsSimules = (config: ConfigService, canal: 'SMS' | 'WHATSAPP') =>
  new Set(
    config
      .get<string>(`MESSAGES_ECHEC_${canal}`, '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean),
  );

/** Développement : le SMS est écrit dans les journaux de l'API, rien n'est envoyé. */
export class JournalSmsSender implements SmsSender {
  private readonly journal = new Logger('SMS');
  constructor(private readonly config: ConfigService) {}

  envoyer(numero: string, texte: string): Promise<ResultatEnvoi> {
    if (echecsSimules(this.config, 'SMS').has(numero)) {
      return Promise.reject(new Error('Échec simulé (MESSAGES_ECHEC_SMS).'));
    }
    this.journal.log(`→ ${numero} : ${texte}`);
    return Promise.resolve({ reference: `journal-${randomUUID()}`, cout: 0 });
  }
}

/**
 * Fournisseur SMS local par HTTP (passerelle d'un opérateur ou d'un agrégateur) :
 * POST SMS_URL { to, from, text } avec la clé SMS_CLE ; réponse { id }.
 */
export class HttpSmsSender implements SmsSender {
  constructor(private readonly config: ConfigService) {}

  async envoyer(numero: string, texte: string): Promise<ResultatEnvoi> {
    const reponse = await fetch(this.config.getOrThrow<string>('SMS_URL'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.getOrThrow<string>('SMS_CLE')}`,
      },
      body: JSON.stringify({
        to: numero,
        from: this.config.get<string>('SMS_EXPEDITEUR', 'GestVente'),
        text: texte,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!reponse.ok) {
      throw new Error(`Passerelle SMS : ${reponse.status} ${(await reponse.text()).slice(0, 200)}`);
    }
    const corps = (await reponse.json().catch(() => ({}))) as { id?: string; messageId?: string };
    return {
      reference: corps.id ?? corps.messageId ?? randomUUID(),
      cout: Number(this.config.get('SMS_COUT', 0)),
    };
  }
}

/** Sans compte WhatsApp Business : tout part en SMS. */
export class AucunWhatsAppSender implements WhatsAppSender {
  readonly disponible = false;
  envoyerModele(): Promise<ResultatEnvoi> {
    return Promise.reject(new Error('WhatsApp n’est pas configuré.'));
  }
}

/** Développement : le message WhatsApp est écrit dans les journaux. */
export class JournalWhatsAppSender implements WhatsAppSender {
  readonly disponible = true;
  private readonly journal = new Logger('WhatsApp');
  constructor(private readonly config: ConfigService) {}

  envoyerModele(numero: string, type: TypeMessage, parametres: string[]): Promise<ResultatEnvoi> {
    if (echecsSimules(this.config, 'WHATSAPP').has(numero)) {
      return Promise.reject(new Error('Échec simulé (MESSAGES_ECHEC_WHATSAPP).'));
    }
    this.journal.log(`→ ${numero} : modèle ${type} (${parametres.join(' | ')})`);
    return Promise.resolve({ reference: `journal-${randomUUID()}`, cout: 0 });
  }
}

/**
 * API WhatsApp Business Cloud (Meta) : messages par modèles approuvés, nommés
 * WHATSAPP_PREFIXE_MODELES + type en minuscules (ex. gestvente_facture).
 */
export class CloudWhatsAppSender implements WhatsAppSender {
  readonly disponible = true;
  constructor(private readonly config: ConfigService) {}

  async envoyerModele(
    numero: string,
    type: TypeMessage,
    parametres: string[],
  ): Promise<ResultatEnvoi> {
    const version = this.config.get<string>('WHATSAPP_VERSION_API', 'v21.0');
    const identifiant = this.config.getOrThrow<string>('WHATSAPP_NUMERO_ID');
    const reponse = await fetch(`https://graph.facebook.com/${version}/${identifiant}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.getOrThrow<string>('WHATSAPP_JETON')}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: `${this.config.get<string>('WHATSAPP_PREFIXE_MODELES', 'gestvente_')}${type.toLowerCase()}`,
          language: { code: this.config.get<string>('WHATSAPP_LANGUE', 'fr') },
          components: [
            { type: 'body', parameters: parametres.map((text) => ({ type: 'text', text })) },
          ],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const corps = (await reponse.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };
    if (!reponse.ok || !corps.messages?.[0]) {
      throw new Error(`WhatsApp : ${corps.error?.message ?? reponse.status}`);
    }
    return {
      reference: corps.messages[0].id,
      cout: Number(this.config.get('WHATSAPP_COUT', 0)),
    };
  }
}

/** Fournisseurs choisis par la configuration (SMS_FOURNISSEUR, WHATSAPP_FOURNISSEUR). */
export function creerSmsSender(config: ConfigService): SmsSender {
  return config.get<string>('SMS_FOURNISSEUR', 'journal') === 'http'
    ? new HttpSmsSender(config)
    : new JournalSmsSender(config);
}

export function creerWhatsAppSender(config: ConfigService): WhatsAppSender {
  switch (config.get<string>('WHATSAPP_FOURNISSEUR', 'aucun')) {
    case 'cloud':
      return new CloudWhatsAppSender(config);
    case 'journal':
      return new JournalWhatsAppSender(config);
    default:
      return new AucunWhatsAppSender();
  }
}
