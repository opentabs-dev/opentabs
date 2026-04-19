import { describe, expect, test, vi } from 'vitest';
import { renderToolCallContent } from './tool.js';

describe('renderToolCallContent', () => {
  test('image part calls saveImage and renders a human summary with the saved path', () => {
    const saveImage = vi.fn().mockReturnValue('/tmp/opentabs-shot.png');
    const out = renderToolCallContent([{ type: 'image', data: 'AAAABBBB', mimeType: 'image/png' }], saveImage);
    expect(saveImage).toHaveBeenCalledWith('AAAABBBB', 'image/png', 0);
    expect(out).toContain('image/png');
    expect(out).toContain('/tmp/opentabs-shot.png');
  });

  test('single text part renders as text verbatim without touching saveImage', () => {
    const saveImage = vi.fn();
    expect(renderToolCallContent([{ type: 'text', text: 'hello' }], saveImage)).toBe('hello');
    expect(saveImage).not.toHaveBeenCalled();
  });

  test('combined text + image: text line first, image summary second', () => {
    const saveImage = vi.fn().mockReturnValue('/tmp/shot.png');
    const out = renderToolCallContent(
      [
        { type: 'text', text: 'preamble' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
      saveImage,
    );
    const lines = out.split('\n');
    expect(lines[0]).toBe('preamble');
    expect(lines[1]).toContain('/tmp/shot.png');
  });

  test('unsupported content part type is reported, not silently dropped', () => {
    const saveImage = vi.fn();
    const out = renderToolCallContent([{ type: 'audio' }], saveImage);
    expect(out).toContain('unsupported');
    expect(out).toContain('audio');
  });

  test('malformed image part (missing mimeType) is reported; saveImage not called', () => {
    const saveImage = vi.fn();
    const out = renderToolCallContent([{ type: 'image', data: 'AAAA' }], saveImage);
    expect(saveImage).not.toHaveBeenCalled();
    expect(out).toContain('malformed');
  });
});
