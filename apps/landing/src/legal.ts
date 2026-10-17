// Public details for Wovenleaf's operator and privacy contact.
export const operator = {
  name: 'Hector Miguel Rodriguez Sosa',
  country: 'Spain',
  email: 'support@wovenleaf.app',
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

export const legalUpdated = { iso: '2026-10-17', label: '17 October 2026' };
