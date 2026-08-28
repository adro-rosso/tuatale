/**
 * Versioned child-photo consent attestations (approved by Adro; legal review to follow).
 *
 * The SERVER stores the canonical `label` text from here — NEVER client-supplied text —
 * so a tampered client can't rewrite what was attested. The client only sends a version
 * id; a later legal rewording bumps the version (child-v2, …) so every stored record says
 * exactly what that customer agreed to. The stored record is { version, text, at }.
 *
 * Not a 'use server' module — plain data, imported by both the client (to render the
 * checkbox copy) and the server action (to store the canonical text).
 */
export type ConsentVersion = 'child-v1' | 'companion-v1';

interface ConsentEntry {
  /** The exact attestation shown at the checkbox AND stored as the consent text. */
  label: string;
  /** Supplementary UI copy (not part of the stored attestation). */
  hint?: string;
}

export const CONSENT: Record<ConsentVersion, ConsentEntry> = {
  // Child protagonist photo — approved as drafted.
  'child-v1': {
    label:
      "I am this child's parent or legal guardian, and I give permission for this photo to be used to illustrate their book.",
    hint:
      "We use it only to create your book's artwork — never anything else. You can remove it any time, and we delete it within 30 days of your book being sent.",
  },
  // Companion photo in a child book — approved, spelled out in full (companions can be
  // children, so the retention terms live inside the attestation itself).
  'companion-v1': {
    label:
      "I have the right to use these photos. For any child shown, I am their parent or legal guardian. We use them only to create your book's artwork — never anything else. You can remove them any time, and we delete them within 30 days of your book being sent.",
  },
};

export function isConsentVersion(v: string): v is ConsentVersion {
  return v === 'child-v1' || v === 'companion-v1';
}

/** The stored consent record: version id + the exact attested text + when. */
export interface PhotoConsentRecord {
  version: ConsentVersion;
  text: string;
  at: string; // ISO timestamp
}

/** Build the record from a version id, taking the CANONICAL text server-side. */
export function buildConsentRecord(version: ConsentVersion, at: string): PhotoConsentRecord {
  return { version, text: CONSENT[version].label, at };
}
