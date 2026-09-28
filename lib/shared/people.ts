// People domain value sets shared by the API and the UI (Master §19-25). Must match the DB CHECKs.
export const SEX_CODES = ["F", "M", "X"] as const;
export const GUARDIAN_RELATIONSHIP_TYPES = ["PARENT", "LEGAL_GUARDIAN"] as const;
export const FRIENDSHIP_VIEWS = ["FRIENDS", "INCOMING", "OUTGOING"] as const;
export const FRIENDSHIP_STATES = ["NONE", "PENDING_OUTGOING", "PENDING_INCOMING", "FRIENDS"] as const;
export const GUEST_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const GUARDIAN_STATUSES = ["PENDING", "ACTIVE", "REVOKED"] as const;

export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
export const GUEST_MIN_AGE = 15;
export const ADULT_AGE = 18;
