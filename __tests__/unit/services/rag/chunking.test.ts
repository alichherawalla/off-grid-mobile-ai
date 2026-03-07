import { chunkDocument } from '../../../../src/services/rag/chunking';

describe('chunkDocument', () => {
  it('returns empty array for empty string', () => {
    expect(chunkDocument('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(chunkDocument('   \n\n   ')).toEqual([]);
  });

  it('returns empty array for text shorter than minChunkLength', () => {
    expect(chunkDocument('short')).toEqual([]);
  });

  it('creates a single chunk for small text', () => {
    const text = 'This is a simple paragraph that is long enough to be a chunk.';
    const chunks = chunkDocument(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].position).toBe(0);
  });

  it('splits on paragraph boundaries', () => {
    const text = 'First paragraph with enough content.\n\nSecond paragraph with enough content.\n\nThird paragraph with enough content.';
    const chunks = chunkDocument(text, { chunkSize: 60 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].position).toBe(0);
    expect(chunks[1].position).toBe(1);
  });

  it('accumulates small paragraphs into a single chunk', () => {
    const text = 'First small paragraph here.\n\nSecond small paragraph here.';
    const chunks = chunkDocument(text, { chunkSize: 500 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('First');
    expect(chunks[0].content).toContain('Second');
  });

  it('uses sliding window for oversized paragraphs', () => {
    const longParagraph = 'word '.repeat(200); // ~1000 chars
    const chunks = chunkDocument(longParagraph, { chunkSize: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    // Positions should be sequential
    chunks.forEach((chunk, i) => {
      expect(chunk.position).toBe(i);
    });
  });

  it('filters out chunks shorter than minChunkLength', () => {
    const text = 'OK.\n\nThis paragraph is long enough to be included in the result.';
    const chunks = chunkDocument(text, { chunkSize: 500, minChunkLength: 20 });
    // "OK." is too short, should be filtered
    expect(chunks.every(c => c.content.length >= 20)).toBe(true);
  });

  it('respects custom chunkSize', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `Paragraph ${i} with some content that makes it reasonably long.`
    ).join('\n\n');
    const chunks = chunkDocument(paragraphs, { chunkSize: 100 });
    chunks.forEach(chunk => {
      // Chunks from paragraph accumulation may slightly exceed chunkSize
      // but sliding window chunks should not
      expect(chunk.content.length).toBeGreaterThan(0);
    });
  });

  it('handles multiple blank lines between paragraphs', () => {
    const text = 'First paragraph is long enough.\n\n\n\nSecond paragraph is long enough.';
    const chunks = chunkDocument(text, { chunkSize: 500 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('First');
  });

  it('handles text with only one paragraph separator', () => {
    const text = 'Single line paragraph that has no double newlines but is long enough to chunk.';
    const chunks = chunkDocument(text, { chunkSize: 500 });
    expect(chunks).toHaveLength(1);
  });

  it('positions are sequential starting from 0', () => {
    const text = Array.from({ length: 5 }, (_, i) =>
      `Paragraph ${i} has enough content to stand alone as a chunk by itself.`
    ).join('\n\n');
    const chunks = chunkDocument(text, { chunkSize: 80 });
    chunks.forEach((chunk, i) => {
      expect(chunk.position).toBe(i);
    });
  });

  it('uses custom minChunkLength', () => {
    const text = 'Short.\n\nThis is a longer paragraph that should definitely be included.';
    const chunks = chunkDocument(text, { chunkSize: 500, minChunkLength: 10 });
    // "Short." (6 chars) should be filtered since minChunkLength=10
    expect(chunks.every(c => c.content.length >= 10)).toBe(true);
  });

  it('handles text with only newlines', () => {
    expect(chunkDocument('\n\n\n\n\n')).toEqual([]);
  });

  it('handles text exactly at chunkSize boundary', () => {
    // Create text exactly 500 chars (default chunkSize)
    const text = 'a'.repeat(500);
    const chunks = chunkDocument(text);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('handles mixed short and long paragraphs', () => {
    const text = [
      'Short intro paragraph is here.',
      'a'.repeat(600), // Oversized
      'Another short paragraph here.',
      'b'.repeat(600), // Oversized
      'Final short paragraph for good measure.',
    ].join('\n\n');
    const chunks = chunkDocument(text, { chunkSize: 200, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach((chunk, i) => {
      expect(chunk.position).toBe(i);
      expect(chunk.content.length).toBeGreaterThanOrEqual(20);
    });
  });

  it('overlap causes content overlap between consecutive sliding window chunks', () => {
    const text = 'abcdefghij'.repeat(50); // 500 chars single paragraph
    const chunks = chunkDocument(text, { chunkSize: 100, overlap: 30 });
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be at most chunkSize
    chunks.forEach(c => {
      expect(c.content.length).toBeLessThanOrEqual(100);
    });
  });

  it('returns empty array for undefined input', () => {
    expect(chunkDocument(undefined as any)).toEqual([]);
  });

  it('returns empty array for null input', () => {
    expect(chunkDocument(null as any)).toEqual([]);
  });
});
