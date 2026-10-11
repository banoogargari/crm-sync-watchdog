// Plain names for the six checks. The codes (C1…C6) are for builders; a CMO
// reading the report only ever sees these names.
export const PROBLEMS = {
  C1: { name: 'Campaign missing in CRM', what: 'A program ran in the marketing tool but never reached the CRM, so its attendees\' activity is invisible to attribution.' },
  C2: { name: 'Attendance not updated in CRM', what: 'The marketing tool shows people attended, but the CRM still says "Registered", so the activity does not count.' },
  C3: { name: 'Form lost ad tracking', what: 'Form fills arrive without their source (UTM), so the deal shows "No source" even when the person came from an ad.' },
  C4: { name: 'Duplicate contacts', what: 'The same person exists twice; the deal sits on the copy with no marketing history.' },
  C5: { name: 'Deal with no contact', what: 'Sales created the opportunity without a contact, so it cannot be traced to any marketing activity.' },
  C6: { name: 'Deal amount ≠ billing', what: 'The won deal amount in the CRM differs from what billing actually charges (billing is correct).' },
};
export const problemName = (code) => PROBLEMS[code]?.name ?? code;
export const CODE_PATTERN = /\bC[1-6]\b/;
