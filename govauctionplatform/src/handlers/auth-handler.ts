import { UnauthorizedError } from '../shared/errors';
import { ESCAPE_HTTP_ORIGIN_SOCKET_IO } from '../globals';
import { jwtVerify } from 'jose';
import { JWKS, KEYCLOAK_ISSUER } from '../shared/keycloak';
import userService from '../services/user-service';

export default {
  /**
   * Verify a Keycloak access token on Socket.io handshake and attach the
   * matching MongoDB user to socket.user.
   */
  deserializeUser: async function (socket: any, bearerToken: string | undefined): Promise<void> {
    // Development bypass — skip auth for local clients
    if (socket.handshake.headers.origin === ESCAPE_HTTP_ORIGIN_SOCKET_IO) {
      return;
    }

    if (!bearerToken) {
      throw new UnauthorizedError('No token supplied');
    }

    // Verify signature + issuer against Keycloak JWKS
    const { payload } = await jwtVerify(bearerToken, JWKS, {
      issuer: KEYCLOAK_ISSUER,
      clockTolerance: 30, // tolerate up to 30s of clock skew between server and Keycloak
    });

    const keycloakId = payload.sub;
    if (!keycloakId) {
      throw new UnauthorizedError('Invalid token: missing sub claim');
    }

    const user = await userService.getByKeycloakId(keycloakId);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    socket.user = user;
  },
} as const;
