import { UnauthorizedError } from '../shared/errors';
import { fauxObject, STATE_JWT_SECRET, ESCAPE_HTTP_ORIGIN_SOCKET_IO } from '../globals';
import { verify } from 'jsonwebtoken';
import userService from '../services/user-service';

export default {
  deserializeUser: async function (socket: any, bearerToken: string | undefined): Promise<void> {
    try {
      // Check if should escape origin in order to bypass auth since we do not need it
      if (socket.handshake.headers.origin === ESCAPE_HTTP_ORIGIN_SOCKET_IO) {
        return;
      } else {
        if (bearerToken) {
          // Verify and decode token
          const verifiedToken = verify(bearerToken, STATE_JWT_SECRET);
          let _decodedToken: fauxObject = {};
    
          if (typeof verifiedToken === 'string') {
            _decodedToken = JSON.parse(verifiedToken);
          } else {
            _decodedToken = verifiedToken;
          }
    
          // Check if exists
          if (!_decodedToken.subject) {
            throw new UnauthorizedError('Invalid token');
          }
    
          // Find user
          const user = await userService.getById(_decodedToken.subject);
    
          if (user) {
            // Set user on request object
            socket.user = user;
          } else {
            throw new UnauthorizedError('Invalid token');
          }
    
          return;
    
        } else {
          throw new UnauthorizedError('No token supplied');
        }
    
      }
    } catch (error) {
      throw error;
    }
  } 
} as const;