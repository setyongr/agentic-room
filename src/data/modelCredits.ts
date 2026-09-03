/**
 * Third-party 3D model credits.
 *
 * Every GLB bundled under `public/models/` is listed here with its full
 * attribution. This manifest is the single source of truth: the web UI
 * renders these entries, and `THIRD_PARTY_NOTICES.md` at the repo root
 * mirrors them for redistribution compliance.
 */

export interface ModelCredit {
  /** The bundled file this entry credits (matches `FurnitureProduct.modelUri`). */
  modelUri: string;
  /** Model title as published by the author. */
  title: string;
  /** Author display name. */
  author: string;
  /** Canonical source page for the model. */
  sourceUrl: string;
  /** License identifier, e.g. "CC BY 4.0". */
  license: string;
  /** Link to the license deed. */
  licenseUrl: string;
}

export const MODEL_CREDITS: readonly ModelCredit[] = [
  {
    modelUri: '/models/sofa-ak-studio.glb',
    title: 'Sofa',
    author: 'AK STUDIO',
    sourceUrl: 'https://skfb.ly/o687Q',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
];

/** Full attribution sentence for one entry (used in docs and the UI). */
export function attributionSentence(credit: ModelCredit): string {
  return `“${credit.title}” (${credit.sourceUrl}) by ${credit.author} is licensed under Creative Commons Attribution (${credit.licenseUrl}).`;
}
