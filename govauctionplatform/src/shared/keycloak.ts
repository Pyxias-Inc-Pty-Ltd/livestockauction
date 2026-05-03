import { createRemoteJWKSet } from 'jose';
import * as axios from 'axios';
import { KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_CLIENT_ID, KEYCLOAK_ADMIN_CLIENT_SECRET, KEYCLOAK_FRONTEND_CLIENT_ID } from '../globals';

// ---------------------------------------------------------------------------
// JWKS — used by deserializeUser to verify Keycloak-issued access tokens
// ---------------------------------------------------------------------------

export const JWKS = createRemoteJWKSet(
  new URL(`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`),
);

export const KEYCLOAK_ISSUER = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;

// ---------------------------------------------------------------------------
// Admin API helpers — used during user creation/management
// ---------------------------------------------------------------------------

/**
 * Obtain a short-lived service-account access token for the Keycloak Admin API.
 * Uses client_credentials grant — requires the client to have "Service Accounts Enabled".
 */
async function getAdminToken(): Promise<string> {
  const tokenUrl =
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', KEYCLOAK_ADMIN_CLIENT_ID);
  params.append('client_secret', KEYCLOAK_ADMIN_CLIENT_SECRET);

  const response = await axios.default.post<{ access_token: string }>(
    tokenUrl,
    params,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  return response.data.access_token;
}

/**
 * Create a user in the Keycloak realm.
 * Returns the Keycloak user ID (sub).
 */
export async function createKeycloakUser(opts: {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  username: string;         // required by Keycloak; we use email or phone
  password?: string;        // omit when using sendWelcomeEmail flow
  temporary?: boolean;      // true → user must change password on next login
}): Promise<string> {
  const token = await getAdminToken();
  const usersUrl = `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users`;

  let createError: unknown;
  try {
    await axios.default.post(
      usersUrl,
      {
        username: opts.username,
        email: opts.email,
        firstName: opts.firstName,
        lastName: opts.lastName,
        enabled: true,
        emailVerified: false,
        attributes: {
          ...(opts.phone ? { phone: opts.phone } : {}),
        },
        ...(opts.password ? {
          credentials: [
            {
              type: 'password',
              value: opts.password,
              temporary: opts.temporary ?? false,
            },
          ],
        } : {}),
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (e) {
    // Keycloak may have created the user but failed to send a verification
    // email (e.g. SMTP not configured). Fall through to the lookup — if the
    // user exists we can proceed; if not, we rethrow the original error.
    createError = e;
  }

  // Re-fetch by username to get the ID (Keycloak puts it in the Location header
  // but axios doesn't expose it easily, so we query instead).
  const searchResp = await axios.default.get<Array<{ id: string }>>(
    `${usersUrl}?username=${encodeURIComponent(opts.username)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const keycloakId = searchResp.data[0]?.id;
  if (!keycloakId) {
    // User was not created — surface the original error
    throw createError ?? new Error('Keycloak user creation failed and user could not be found');
  }

  return keycloakId;
}

/**
 * Assign a realm-level role to a Keycloak user.
 * The role must already exist in the realm (create it in the Keycloak UI).
 */
export async function assignRealmRole(keycloakUserId: string, roleName: string): Promise<void> {
  const token = await getAdminToken();
  const baseUrl = `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}`;

  // Fetch role representation
  const roleResp = await axios.default.get<{ id: string; name: string }>(
    `${baseUrl}/roles/${encodeURIComponent(roleName)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  // Assign to user
  await axios.default.post(
    `${baseUrl}/users/${keycloakUserId}/role-mappings/realm`,
    [roleResp.data],
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

/**
 * Reset a Keycloak user's password via the Admin API.
 */
export async function resetKeycloakUserPassword(
  keycloakUserId: string,
  newPassword: string,
  temporary = false,
): Promise<void> {
  const token = await getAdminToken();
  await axios.default.put(
    `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${keycloakUserId}/reset-password`,
    { type: 'password', value: newPassword, temporary },
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

/**
 * Delete a Keycloak user by their Keycloak ID.
 */
export async function deleteKeycloakUser(keycloakUserId: string): Promise<void> {
  const token = await getAdminToken();
  await axios.default.delete(
    `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${keycloakUserId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

// ---------------------------------------------------------------------------
// BFF token exchange helpers — used by auth-router for PKCE flow
// ---------------------------------------------------------------------------

/**
 * Exchange a PKCE authorization code for access + refresh tokens.
 * Called by the BFF POST /auth/exchange endpoint.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const params = new URLSearchParams();
  params.append('grant_type', 'authorization_code');
  params.append('client_id', KEYCLOAK_FRONTEND_CLIENT_ID);
  params.append('code', code);
  params.append('code_verifier', codeVerifier);
  params.append('redirect_uri', redirectUri);

  const response = await axios.default.post<{ access_token: string; refresh_token: string }>(
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
    params,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  return {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token,
  };
}

/**
 * Use a refresh token to obtain a new access token + rotated refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('client_id', KEYCLOAK_FRONTEND_CLIENT_ID);
  params.append('refresh_token', refreshToken);

  const response = await axios.default.post<{ access_token: string; refresh_token: string }>(
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
    params,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  return {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token,
  };
}

/**
 * Revoke a refresh token (called on logout).
 */
export async function revokeToken(refreshToken: string): Promise<void> {
  const params = new URLSearchParams();
  params.append('client_id', KEYCLOAK_FRONTEND_CLIENT_ID);
  params.append('token', refreshToken);
  params.append('token_type_hint', 'refresh_token');

  await axios.default.post(
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/revoke`,
    params,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
}

/**
 * Send a "set up your password" email to a newly created user.
 * Uses Keycloak's execute-actions-email endpoint with UPDATE_PASSWORD.
 * The admin never sees or handles a temporary password — the user sets
 * their own credentials by clicking the link in the email.
 */
export async function sendWelcomeEmail(keycloakUserId: string): Promise<void> {
  const token = await getAdminToken();
  await axios.default.put(
    `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${keycloakUserId}/execute-actions-email`,
    ['UPDATE_PASSWORD'],
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );
}
