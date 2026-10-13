import { UploadValidationError } from "@antelopejs/interface-file-storage";

const SizeMismatchMessage = "Body size mismatch";

export type UploadBody = Uint8Array | AsyncIterable<Uint8Array>;

function sizeMismatch(): UploadValidationError {
  return new UploadValidationError(SizeMismatchMessage, "SIZE_EXCEEDED");
}

function toChunks(
  body: UploadBody,
): Iterable<Uint8Array> | AsyncIterable<Uint8Array> {
  return body instanceof Uint8Array ? [body] : body;
}

export async function* exactSizeChunks(
  body: UploadBody,
  size: number,
): AsyncGenerator<Uint8Array> {
  let received = 0;
  for await (const chunk of toChunks(body)) {
    received += chunk.byteLength;
    if (received > size) throw sizeMismatch();
    yield chunk;
  }
  if (received !== size) throw sizeMismatch();
}
