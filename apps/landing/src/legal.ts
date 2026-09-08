// Confirm these public operator details before publishing the legal pages.
export const operator = {
  name: 'OPERATOR_NAME_PENDING',
  country: 'OPERATOR_COUNTRY_PENDING',
  email: 'OPERATOR_EMAIL_PENDING',
};

if (
  import.meta.env.PROD &&
  (Object.values(operator).some(
    (value) => value.includes('_PENDING') || !value.trim(),
  ) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operator.email))
) {
  throw new Error(
    'Confirm the public operator name, country, and contact email in src/legal.ts before publishing the legal pages.',
  );
}

export const legalUpdated = { iso: '2026-09-08', label: '8 September 2026' };
