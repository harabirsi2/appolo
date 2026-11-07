export const ROLES = ["owner", "admin", "manager", "agent", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  "org:manage",
  "org:billing",
  "users:manage",
  "locations:manage",
  "contacts:read",
  "contacts:write",
  "contacts:export",
  "messages:read",
  "messages:send",
  "reviews:read",
  "reviews:respond",
  "automations:manage",
  "ai:manage",
  "reports:view",
  "data:export",
  "audit:view",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const MATRIX: Record<Role, readonly Capability[]> = {
  owner: [...CAPABILITIES],
  admin: CAPABILITIES.filter((c) => c !== "org:billing"),
  manager: [
    "locations:manage",
    "contacts:read",
    "contacts:write",
    "contacts:export",
    "messages:read",
    "messages:send",
    "reviews:read",
    "reviews:respond",
    "automations:manage",
    "ai:manage",
    "reports:view",
    "data:export",
    "audit:view",
  ],
  agent: [
    "contacts:read",
    "contacts:write",
    "messages:read",
    "messages:send",
    "reviews:read",
    "reviews:respond",
    "reports:view",
  ],
  viewer: ["contacts:read", "messages:read", "reviews:read", "reports:view"],
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role].includes(capability);
}

export function capabilitiesFor(role: Role): readonly Capability[] {
  return MATRIX[role];
}

export function assertCan(role: Role, capability: Capability): void {
  if (!can(role, capability)) {
    const err = new Error(`Role "${role}" cannot "${capability}"`);
    (err as Error & { code?: string }).code = "FORBIDDEN";
    throw err;
  }
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}