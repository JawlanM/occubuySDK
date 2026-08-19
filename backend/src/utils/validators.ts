// same rules as the SDK and the mock form check on their end, but those are just UX,
// this is the one that actually blocks bad data since someone could hit the API directly

const AU_MOBILE = /^(?:\+?61|0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ApplicantInput {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
  dob?: unknown;
  address?: unknown;
}

export interface ValidatedApplicant {
  fullName: string;
  email: string;
  phone: string;
  dob: string;
  address: string;
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

function isNonEmptyString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

export function validateApplicant(
  input: ApplicantInput
): { ok: true; applicant: ValidatedApplicant } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  if (!isNonEmptyString(input.fullName, 2, 100)) {
    errors.push({ field: "fullName", code: "INVALID_FULL_NAME", message: "Full name must be 2-100 characters." });
  }

  if (!isNonEmptyString(input.email, 5, 254) || !EMAIL.test((input.email as string).trim())) {
    errors.push({ field: "email", code: "INVALID_EMAIL", message: "Enter a valid email address." });
  }

  if (typeof input.phone !== "string" || !AU_MOBILE.test(input.phone.trim())) {
    errors.push({
      field: "phone",
      code: "INVALID_PHONE",
      message: "Enter a valid Australian mobile number, e.g. 04XX XXX XXX.",
    });
  }

  if (typeof input.dob !== "string" || !ISO_DATE.test(input.dob)) {
    errors.push({ field: "dob", code: "INVALID_DOB", message: "Date of birth must be a valid date (YYYY-MM-DD)." });
  } else {
    const dobDate = new Date(`${input.dob}T00:00:00Z`);
    const now = new Date();
    if (Number.isNaN(dobDate.getTime()) || dobDate.getTime() > now.getTime()) {
      errors.push({ field: "dob", code: "INVALID_DOB", message: "Date of birth cannot be in the future." });
    } else {
      let age = now.getUTCFullYear() - dobDate.getUTCFullYear();
      const hadBirthdayThisYear =
        now.getUTCMonth() > dobDate.getUTCMonth() ||
        (now.getUTCMonth() === dobDate.getUTCMonth() && now.getUTCDate() >= dobDate.getUTCDate());
      if (!hadBirthdayThisYear) age -= 1;
      if (age < 18) {
        errors.push({ field: "dob", code: "UNDERAGE", message: "You must be 18 or older to use Occubuy Score." });
      }
    }
  }

  if (!isNonEmptyString(input.address, 5, 200)) {
    errors.push({ field: "address", code: "INVALID_ADDRESS", message: "Address must be 5-200 characters." });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    applicant: {
      fullName: (input.fullName as string).trim(),
      email: (input.email as string).trim().toLowerCase(),
      phone: (input.phone as string).trim(),
      dob: input.dob as string,
      address: (input.address as string).trim(),
    },
  };
}
