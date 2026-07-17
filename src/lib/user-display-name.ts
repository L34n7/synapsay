const EMAIL_LOCAL_PART_PATTERN = /^[^\s@]+@[^\s@]+$/;
const EMAIL_DERIVED_NAME_PATTERN = /^[^\s@._+-]+[._+-][^\s@]+$/;

function titleCaseFirstToken(value: string) {
  const token = value
    .split(/[._+-]/)[0]
    ?.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]+/g, " ")
    .trim();
  if (!token) return "";

  return (
    token.charAt(0).toLocaleUpperCase("pt-BR") +
    token.slice(1).toLocaleLowerCase("pt-BR")
  );
}

export function profileDisplayName(value: unknown) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  if (EMAIL_LOCAL_PART_PATTERN.test(trimmed)) {
    return titleCaseFirstToken(trimmed.split("@")[0] ?? "");
  }

  if (!trimmed.includes(" ") && EMAIL_DERIVED_NAME_PATTERN.test(trimmed)) {
    return titleCaseFirstToken(trimmed);
  }

  return trimmed.slice(0, 80);
}

export function firstProfileName(value: unknown) {
  return profileDisplayName(value).split(/\s+/)[0]?.slice(0, 40) ?? "";
}
