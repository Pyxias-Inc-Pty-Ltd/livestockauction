import { IUser } from '../../models/user-model';

declare global {
  namespace Express {
    interface Request {
      /** Full MongoDB user document — set by deserializeUser via keycloakId lookup. */
      user?: IUser;
      /**
       * Coarse realm-level roles from the verified Keycloak JWT
       * (`realm_access.roles`).  Example: ['SELLER', 'offline_access'].
       */
      roles: string[];
      /**
       * Fine-grained client-level permissions from the verified Keycloak JWT
       * (`resource_access.<clientId>.roles`).  Example: ['auction:create', 'lot:read'].
       * Populated only when the client has client roles assigned in Keycloak.
       */
      permissions: string[];
    }
  }
}
