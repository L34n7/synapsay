const EMAIL_LOCAL_PART_PATTERN = /^[^\s@]+@[^\s@]+$/;
const EMAIL_DERIVED_NAME_PATTERN = /^[^\s@._+-]+[._+-][^\s@]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

export function validateDisplayNameInput(value: unknown) {
  if (typeof value !== "string") {
    return { value: "", error: "Informe como você quer ser chamado." };
  }

  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 40) {
    return { value: "", error: "Seu nome deve ter entre 2 e 40 caracteres." };
  }

  if (trimmed.includes("@") || EMAIL_DERIVED_NAME_PATTERN.test(trimmed)) {
    return {
      value: "",
      error: "Digite seu nome como quer ser chamado, sem usar o e-mail.",
    };
  }

  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(trimmed)) {
    return { value: "", error: "Digite um nome válido." };
  }

  return { value: trimmed, error: "" };
}

export function profileBirthday(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) return "";

  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toISOString().slice(0, 10) !== trimmed) return "";

  return trimmed;
}

export function validateBirthdayInput(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return { value: null as string | null, error: "" };
  }

  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return {
      value: null,
      error: "Informe a data de aniversário no formato AAAA-MM-DD.",
    };
  }

  const birthday = profileBirthday(value);
  if (!birthday) {
    return { value: null, error: "Informe uma data de aniversário válida." };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (birthday > today) {
    return {
      value: null,
      error: "A data de aniversário não pode ser no futuro.",
    };
  }

  if (Number(birthday.slice(0, 4)) < 1900) {
    return {
      value: null,
      error: "Informe uma data de aniversário a partir de 1900.",
    };
  }

  return { value: birthday, error: "" };
}
