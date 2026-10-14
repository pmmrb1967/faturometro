/**
 * Public key of the project maintainer (pnpm contrib:keygen): layout contributions
 * are encrypted with it and only its private pair, kept off the repository, reads them.
 */
export const MAINTAINER_PUBLIC_KEY: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'KRjeYRdBJ6L1tVE36-V5c9yTgftz0c3idbMyt-5uWqs',
  y: 'GXWV8zMecidAFvaJ4ViSG5qL8SMrlkdvGgTeEuX6mcU',
};
