import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { RequeteAuthentifiee, UtilisateurConnecte } from '../auth.types.js';
import { ParamBoutique, Public, Roles } from '../decorateurs.js';
import { BoutiqueGuard } from './boutique.guard.js';
import { contexteHttp } from './contexte.test-utils.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

const SECRET = 'secret-de-test-assez-long-pour-hs256!!';

/** Base simulée : un appareil, son utilisateur et les boutiques du commerce. */
function prismaSimule(appareil: unknown, boutiques = [{ id: 'A', commerceId: 'c1' }]) {
  return {
    appareil: { findUnique: async () => appareil },
    boutique: {
      findMany: async () => boutiques.map(({ id }) => ({ id })),
      findUnique: async ({ where }: { where: { id: string } }) =>
        boutiques.find((b) => b.id === where.id) ?? null,
    },
  } as unknown as PrismaService;
}

const appareilActif = (role: Role = Role.VENDEUR) => ({
  revoqueLe: null,
  utilisateur: {
    id: 'u1',
    commerceId: 'c1',
    role,
    actif: true,
    boutiques: [{ boutiqueId: 'A' }],
    commerce: { statut: 'ACTIF', motifStatut: null as string | null },
  },
});

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: SECRET });
  const garde = (appareil: unknown = appareilActif()) =>
    new JwtAuthGuard(jwt, new Reflector(), prismaSimule(appareil));
  const jetonValide = () => jwt.signAsync({ sub: 'u1', commerceId: 'c1', appareilId: 'ap1' });
  const avecJeton = (jeton: string) =>
    contexteHttp({ headers: { authorization: `Bearer ${jeton}` } });

  it('laisse passer une route @Public() sans jeton', async () => {
    class Controleur {
      @Public()
      route() {}
    }
    await expect(garde().canActivate(contexteHttp({}, Controleur, 'route'))).resolves.toBe(true);
  });

  it('refuse une requête sans jeton, un jeton étranger ou expiré', async () => {
    await expect(garde().canActivate(contexteHttp({}))).rejects.toThrow(UnauthorizedException);
    const etranger = await new JwtService({
      secret: 'un-autre-secret-de-test-tout-aussi-long',
    }).signAsync({
      sub: 'u1',
    });
    await expect(garde().canActivate(avecJeton(etranger))).rejects.toThrow(UnauthorizedException);
    const expire = await jwt.signAsync({ sub: 'u1' }, { expiresIn: -10 });
    await expect(garde().canActivate(avecJeton(expire))).rejects.toThrow(UnauthorizedException);
  });

  it('refuse un appareil déconnecté à distance ou un compte désactivé', async () => {
    const jeton = await jetonValide();
    const revoque = { ...appareilActif(), revoqueLe: new Date() };
    await expect(garde(revoque).canActivate(avecJeton(jeton))).rejects.toThrow(
      UnauthorizedException,
    );
    const inactif = appareilActif();
    inactif.utilisateur.actif = false;
    await expect(garde(inactif).canActivate(avecJeton(jeton))).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(garde(null).canActivate(avecJeton(jeton))).rejects.toThrow(UnauthorizedException);
  });

  it("attache l'utilisateur et ses boutiques à la requête", async () => {
    const ctx = avecJeton(await jetonValide());
    await expect(garde().canActivate(ctx)).resolves.toBe(true);
    expect(ctx.switchToHttp().getRequest<RequeteAuthentifiee>().utilisateur).toEqual({
      id: 'u1',
      role: Role.VENDEUR,
      commerceId: 'c1',
      appareilId: 'ap1',
      boutiqueIds: ['A'],
    });
  });

  it('le propriétaire reçoit toutes les boutiques du commerce', async () => {
    const g = new JwtAuthGuard(
      jwt,
      new Reflector(),
      prismaSimule(appareilActif(Role.PROPRIETAIRE), [
        { id: 'A', commerceId: 'c1' },
        { id: 'B', commerceId: 'c1' },
      ]),
    );
    const ctx = avecJeton(await jetonValide());
    await g.canActivate(ctx);
    expect(ctx.switchToHttp().getRequest<RequeteAuthentifiee>().utilisateur?.boutiqueIds).toEqual([
      'A',
      'B',
    ]);
  });

  it('refuse les sessions d’un commerce suspendu par la plateforme (403)', async () => {
    const appareil = appareilActif();
    appareil.utilisateur.commerce = { statut: 'SUSPENDU', motifStatut: 'Abonnement impayé' };
    await expect(garde(appareil).canActivate(avecJeton(await jetonValide()))).rejects.toThrow(
      /suspendu \(Abonnement impayé\)/,
    );
  });

  it('refuse un jeton du concepteur (sans appareil)', async () => {
    const jeton = await jwt.signAsync({ type: 'concepteur', sub: 'k1' });
    await expect(garde().canActivate(avecJeton(jeton))).rejects.toThrow(UnauthorizedException);
  });
});

const utilisateur = (role: Role, boutiqueIds = ['A']): UtilisateurConnecte => ({
  id: 'u1',
  role,
  commerceId: 'c1',
  appareilId: 'ap1',
  boutiqueIds,
});

describe('RolesGuard', () => {
  class Controleur {
    @Roles(Role.PROPRIETAIRE, Role.GERANT)
    reservee() {}
    libre() {}
  }
  const garde = new RolesGuard(new Reflector());

  it('laisse passer un rôle autorisé et toute route sans @Roles', () => {
    expect(
      garde.canActivate(
        contexteHttp({ utilisateur: utilisateur(Role.GERANT) }, Controleur, 'reservee'),
      ),
    ).toBe(true);
    expect(
      garde.canActivate(
        contexteHttp({ utilisateur: utilisateur(Role.VENDEUR) }, Controleur, 'libre'),
      ),
    ).toBe(true);
  });

  it('refuse un rôle non autorisé', () => {
    expect(() =>
      garde.canActivate(
        contexteHttp({ utilisateur: utilisateur(Role.VENDEUR) }, Controleur, 'reservee'),
      ),
    ).toThrow(ForbiddenException);
  });
});

describe('BoutiqueGuard', () => {
  class Controleur {
    route() {}
    @ParamBoutique('id')
    autreNom() {}
  }
  const boutiques = [
    { id: 'A', commerceId: 'c1' },
    { id: 'B', commerceId: 'c1' },
    { id: 'X', commerceId: 'c2' },
  ];
  const garde = new BoutiqueGuard(new Reflector(), prismaSimule(null, boutiques));
  const ctx = (u: UtilisateurConnecte, requete: Partial<RequeteAuthentifiee>, methode = 'route') =>
    contexteHttp({ utilisateur: u, ...requete }, Controleur, methode);

  it('laisse passer la boutique de rattachement (chemin, requête ou corps)', async () => {
    const vendeur = utilisateur(Role.VENDEUR);
    await expect(garde.canActivate(ctx(vendeur, { params: { boutiqueId: 'A' } }))).resolves.toBe(
      true,
    );
    await expect(
      garde.canActivate(ctx(vendeur, { query: { boutiqueId: 'A' } as never })),
    ).resolves.toBe(true);
    await expect(garde.canActivate(ctx(vendeur, { body: { boutiqueId: 'A' } }))).resolves.toBe(
      true,
    );
    await expect(
      garde.canActivate(ctx(vendeur, { params: { id: 'A' } }, 'autreNom')),
    ).resolves.toBe(true);
  });

  it("refuse une autre boutique du commerce (403) et celle d'un autre commerce (404)", async () => {
    const vendeur = utilisateur(Role.VENDEUR);
    await expect(garde.canActivate(ctx(vendeur, { params: { boutiqueId: 'B' } }))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(garde.canActivate(ctx(vendeur, { params: { boutiqueId: 'X' } }))).rejects.toThrow(
      NotFoundException,
    );
    await expect(garde.canActivate(ctx(vendeur, { params: { boutiqueId: 'Z' } }))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('le propriétaire passe sur toutes les boutiques de son commerce', async () => {
    const proprietaire = utilisateur(Role.PROPRIETAIRE, []);
    await expect(
      garde.canActivate(ctx(proprietaire, { params: { boutiqueId: 'B' } })),
    ).resolves.toBe(true);
    await expect(
      garde.canActivate(ctx(proprietaire, { params: { boutiqueId: 'X' } })),
    ).rejects.toThrow(NotFoundException);
  });

  it('exige le paramètre', async () => {
    await expect(garde.canActivate(ctx(utilisateur(Role.VENDEUR), {}))).rejects.toThrow(
      BadRequestException,
    );
  });
});
