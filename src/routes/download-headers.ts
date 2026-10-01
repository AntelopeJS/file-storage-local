import {
  FilenameMetadataKey,
  type StoredFileMetadata,
} from "../storage/token-manager";

const FallbackContentType = "application/octet-stream";
const ResourceKeySeparator = "/";
const QuotedStringSpecials = new Set(['"', "\\"]);
const FirstPrintableCode = 0x20;
const DeleteCode = 0x7f;
const NonAsciiCharacters = /[^ -~]/gu;
const CombiningMarks = /\p{Mn}/gu;
const LoneSurrogates =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const NonAttrCharacters = /['()*]/g;
const AsciiReplacement = "_";
const UnicodeReplacement = String.fromCodePoint(0xfffd);
const HexRadix = 16;

export const NoSniffHeaderValue = "nosniff";

export function resolveContentType(mimetype: string | undefined): string {
  return mimetype?.trim() || FallbackContentType;
}

export function resolveDownloadFilename(
  metadata: StoredFileMetadata,
  resourceKey: string,
): string {
  const storedFilename = metadata.metadata?.[FilenameMetadataKey];
  if (storedFilename) {
    return storedFilename;
  }
  return resourceKey.split(ResourceKeySeparator).pop() || resourceKey;
}

function isQuotableCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    code >= FirstPrintableCode &&
    code !== DeleteCode &&
    !QuotedStringSpecials.has(character)
  );
}

function toAsciiFilename(filename: string): string {
  return Array.from(filename.normalize("NFKD").replace(CombiningMarks, ""))
    .filter(isQuotableCharacter)
    .join("")
    .replace(NonAsciiCharacters, AsciiReplacement);
}

function percentEncode(character: string): string {
  return `%${character.charCodeAt(0).toString(HexRadix).toUpperCase()}`;
}

function toExtendedFilename(filename: string): string {
  return encodeURIComponent(
    filename.replace(LoneSurrogates, UnicodeReplacement),
  ).replace(NonAttrCharacters, percentEncode);
}

export function buildContentDisposition(filename: string): string {
  return `inline; filename="${toAsciiFilename(filename)}"; filename*=UTF-8''${toExtendedFilename(filename)}`;
}
