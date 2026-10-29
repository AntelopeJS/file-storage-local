import { join } from "node:path";

const KeySeparator = "/";
const RelativeSegments = new Set([".", ".."]);
const NullCharacter = "\0";
const WindowsForbiddenCharacters = /[<>:"\\|?*]/;
const WindowsTrailingCharacters = /[. ]$/;
const WindowsReservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const FirstPrintableCode = 0x20;

type SegmentRule = (segment: string) => boolean;

function hasControlCharacter(segment: string): boolean {
  return Array.from(segment).some(
    (character) => character.charCodeAt(0) < FirstPrintableCode,
  );
}

const PortableRules: SegmentRule[] = [
  (segment) => RelativeSegments.has(segment),
  (segment) => segment.includes(NullCharacter),
];

const PlatformRules: Partial<Record<NodeJS.Platform, SegmentRule[]>> = {
  win32: [
    (segment) => WindowsForbiddenCharacters.test(segment),
    hasControlCharacter,
    (segment) => WindowsTrailingCharacters.test(segment),
    (segment) => WindowsReservedNames.test(segment),
  ],
};

export class InvalidResourceKeyError extends Error {
  constructor(resourceKey: string) {
    super(`Resource key '${resourceKey}' cannot be stored on this filesystem`);
    this.name = "InvalidResourceKeyError";
  }
}

function isUnstorableSegment(segment: string): boolean {
  const platformRules = PlatformRules[process.platform] ?? [];
  return [...PortableRules, ...platformRules].some((rule) => rule(segment));
}

export function isStorableKey(resourceKey: string): boolean {
  const segments = resourceKey.split(KeySeparator).filter(Boolean);
  return segments.length > 0 && !segments.some(isUnstorableSegment);
}

export function resolveKeyPath(base: string, resourceKey: string): string {
  if (!isStorableKey(resourceKey))
    throw new InvalidResourceKeyError(resourceKey);
  return join(base, ...resourceKey.split(KeySeparator));
}
