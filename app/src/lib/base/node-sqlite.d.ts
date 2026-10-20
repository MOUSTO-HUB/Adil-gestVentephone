// Déclaration minimale de node:sqlite (Node.js 22.13+), utilisé seulement par les
// tests de la base locale : l'application n'embarque pas les types de Node.
declare module 'node:sqlite' {
  type Valeur = string | number | null;
  interface Instruction {
    run(...params: Valeur[]): unknown;
    all(...params: Valeur[]): unknown[];
    get(...params: Valeur[]): unknown;
  }
  export class DatabaseSync {
    constructor(chemin: string);
    exec(sql: string): void;
    prepare(sql: string): Instruction;
  }
}
