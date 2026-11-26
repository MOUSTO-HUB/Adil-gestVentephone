import { useEffect, useState } from 'react';
import { Carte, Champ, Texte } from '@/components/ui';
import { empreinteAppareil } from '@/lib/cle-appareil';

/**
 * Nouvel appareil : saisie du code d'autorisation donné par un administrateur, et
 * empreinte de l'appareil (pour le reconnaître dans la liste des appareils autorisés).
 */
export function AutorisationAppareil({
  code,
  surCode,
  qui,
}: {
  code: string;
  surCode: (code: string) => void;
  /** Qui donne le code : « le propriétaire… » ou « un autre concepteur ». */
  qui: string;
}) {
  const [empreinte, setEmpreinte] = useState<string | null>(null);
  useEffect(() => {
    empreinteAppareil().then(setEmpreinte, () => setEmpreinte(null));
  }, []);

  return (
    <Carte titre="Nouvel appareil à autoriser" icone="shield-checkmark">
      <Texte>
        Pour votre sécurité, chaque ordinateur, téléphone ou tablette doit être autorisé. Demandez
        un code d’autorisation à {qui}, puis saisissez-le ici avec votre mot de passe.
      </Texte>
      <Champ
        libelle="Code d’autorisation (8 caractères)"
        value={code}
        onChangeText={surCode}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABCD-EFGH"
        maxLength={12}
      />
      {empreinte ? <Texte discret>Empreinte de cet appareil : {empreinte}</Texte> : null}
    </Carte>
  );
}
