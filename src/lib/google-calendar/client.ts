import { decryptGoogleToken, encryptGoogleToken } from "@/lib/google-calendar/crypto";
import { googleCalendarConfig } from "@/lib/google-calendar/config";
import { createAdminClient } from "@/lib/supabase/admin";

export type SyncDirection =
  | "bidirectional"
  | "google_to_synapsay"
  | "synapsay_to_google";

export type GoogleCalendarIntegration = {
  user_id: string;
  google_account_id: string;
  google_email: string;
  google_name: string | null;
  google_picture_url: string | null;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string;
  granted_scopes: string[];
  selected_calendar_id: string;
  selected_calendar_name: string;
  selected_calendar_timezone: string;
  sync_enabled: boolean;
  sync_direction: SyncDirection;
  last_sync_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly code = "google_calendar_error",
  ) {
    super(message);
  }
}

export async function getGoogleCalendarIntegration(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("google_calendar_integrations")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new GoogleCalendarError(error.message);
  return data as GoogleCalendarIntegration | null;
}

export async function exchangeGoogleAuthorizationCode(code: string) {
  const config = googleCalendarConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new GoogleCalendarError(
      payload.error_description ?? "O Google não autorizou a conexão.",
      400,
      payload.error ?? "oauth_exchange_failed",
    );
  }
  return payload;
}

export async function fetchGoogleProfile(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const profile = (await response.json().catch(() => ({}))) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  if (!response.ok || !profile.sub || !profile.email) {
    throw new GoogleCalendarError(
      "Não foi possível identificar a conta Google autorizada.",
      400,
      "google_profile_failed",
    );
  }
  return profile as Required<Pick<typeof profile, "sub" | "email">> & typeof profile;
}

export async function saveGoogleAuthorization({
  userId,
  tokens,
}: {
  userId: string;
  tokens: GoogleTokenResponse & { access_token: string };
}) {
  const admin = createAdminClient();
  const [profile, current] = await Promise.all([
    fetchGoogleProfile(tokens.access_token),
    getGoogleCalendarIntegration(userId),
  ]);
  const sameGoogleAccount = current?.google_account_id === profile.sub;
  const refreshTokenCiphertext = tokens.refresh_token
    ? encryptGoogleToken(tokens.refresh_token)
    : sameGoogleAccount
      ? current?.refresh_token_ciphertext ?? null
      : null;
  if (!refreshTokenCiphertext) {
    throw new GoogleCalendarError(
      "O Google não enviou uma credencial de acesso permanente. Remova o acesso antigo na sua Conta Google e conecte novamente.",
      400,
      "refresh_token_missing",
    );
  }
  if (current && !sameGoogleAccount) {
    const { error } = await admin
      .from("google_calendar_integrations")
      .delete()
      .eq("user_id", userId);
    if (error) throw new GoogleCalendarError(error.message);
  }

  const expiresAt = new Date(
    Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000,
  ).toISOString();
  const { error } = await admin.from("google_calendar_integrations").upsert({
    user_id: userId,
    google_account_id: profile.sub,
    google_email: profile.email,
    google_name: profile.name ?? null,
    google_picture_url: profile.picture ?? null,
    access_token_ciphertext: encryptGoogleToken(tokens.access_token),
    refresh_token_ciphertext: refreshTokenCiphertext,
    access_token_expires_at: expiresAt,
    granted_scopes: tokens.scope?.split(/\s+/).filter(Boolean) ?? [],
    ...(sameGoogleAccount
      ? {}
      : {
          selected_calendar_id: "primary",
          selected_calendar_name: "Agenda principal",
          selected_calendar_timezone: "America/Sao_Paulo",
        }),
    sync_enabled: true,
    last_sync_at: null,
    last_sync_error: null,
  });
  if (error) throw new GoogleCalendarError(error.message);
}

async function refreshGoogleAccessToken(integration: GoogleCalendarIntegration) {
  if (!integration.refresh_token_ciphertext) {
    throw new GoogleCalendarError(
      "A conexão com o Google expirou. Conecte sua conta novamente.",
      401,
      "google_reconnect_required",
    );
  }
  const config = googleCalendarConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: decryptGoogleToken(integration.refresh_token_ciphertext),
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    const message =
      payload.error === "invalid_grant"
        ? "O acesso ao Google Agenda foi revogado. Conecte a conta novamente."
        : payload.error_description ?? "Não foi possível renovar o acesso ao Google Agenda.";
    await createAdminClient()
      .from("google_calendar_integrations")
      .update({ sync_enabled: false, last_sync_error: message })
      .eq("user_id", integration.user_id);
    throw new GoogleCalendarError(
      message,
      401,
      payload.error === "invalid_grant" ? "google_reconnect_required" : "token_refresh_failed",
    );
  }

  const expiresAt = new Date(
    Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
  ).toISOString();
  const { error } = await createAdminClient()
    .from("google_calendar_integrations")
    .update({
      access_token_ciphertext: encryptGoogleToken(payload.access_token),
      access_token_expires_at: expiresAt,
      granted_scopes:
        payload.scope?.split(/\s+/).filter(Boolean) ?? integration.granted_scopes,
      last_sync_error: null,
    })
    .eq("user_id", integration.user_id);
  if (error) throw new GoogleCalendarError(error.message);
  return payload.access_token;
}

export async function getGoogleAccessToken(userId: string) {
  const integration = await getGoogleCalendarIntegration(userId);
  if (!integration) {
    throw new GoogleCalendarError(
      "Google Agenda não conectado.",
      404,
      "google_not_connected",
    );
  }
  if (new Date(integration.access_token_expires_at).getTime() > Date.now() + 120_000) {
    return { accessToken: decryptGoogleToken(integration.access_token_ciphertext), integration };
  }
  const accessToken = await refreshGoogleAccessToken(integration);
  return {
    accessToken,
    integration: {
      ...integration,
      access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
  };
}

export async function googleCalendarFetch<T>({
  userId,
  path,
  method = "GET",
  body,
}: {
  userId: string;
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}) {
  const { accessToken } = await getGoogleAccessToken(userId);
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 204) return null as T;
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number };
  };
  if (!response.ok) {
    throw new GoogleCalendarError(
      payload.error?.message ?? "O Google Agenda recusou a operação.",
      response.status,
      "google_api_error",
    );
  }
  return payload;
}

export function publicIntegrationStatus(integration: GoogleCalendarIntegration | null) {
  if (!integration) return { connected: false as const };
  return {
    connected: true as const,
    email: integration.google_email,
    name: integration.google_name,
    pictureUrl: integration.google_picture_url,
    calendarId: integration.selected_calendar_id,
    calendarName: integration.selected_calendar_name,
    calendarTimezone: integration.selected_calendar_timezone,
    syncEnabled: integration.sync_enabled,
    syncDirection: integration.sync_direction,
    lastSyncAt: integration.last_sync_at,
    lastSyncError: integration.last_sync_error,
    reconnectRequired:
      !integration.sync_enabled &&
      integration.last_sync_error?.toLowerCase().includes("revogado"),
  };
}
