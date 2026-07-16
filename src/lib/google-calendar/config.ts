export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export function googleCalendarConfig() {
  const clientId =
    process.env.GOOGLE_CALENDAR_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Configure GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET e GOOGLE_CALENDAR_REDIRECT_URI.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}
