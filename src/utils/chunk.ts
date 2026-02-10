const MAX_LENGTH = 1950; // Leave some room under Discord's 2000 char limit

/**
 * Split a long message into Discord-safe chunks.
 * Splits on paragraph boundaries first, then sentences, then hard cut.
 */
export function chunkMessage(text: string): string[] {
  if (text.length <= MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;

    // Try to split on double newline (paragraph boundary)
    const paragraphBreak = remaining.lastIndexOf('\n\n', MAX_LENGTH);
    if (paragraphBreak > MAX_LENGTH * 0.3) {
      splitAt = paragraphBreak + 2;
    }

    // Try single newline
    if (splitAt === -1) {
      const lineBreak = remaining.lastIndexOf('\n', MAX_LENGTH);
      if (lineBreak > MAX_LENGTH * 0.3) {
        splitAt = lineBreak + 1;
      }
    }

    // Try sentence boundary
    if (splitAt === -1) {
      const sentence = remaining.lastIndexOf('. ', MAX_LENGTH);
      if (sentence > MAX_LENGTH * 0.3) {
        splitAt = sentence + 2;
      }
    }

    // Hard cut
    if (splitAt === -1) {
      splitAt = MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
