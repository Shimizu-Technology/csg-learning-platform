import { formatFileSize, pendingAttachment, validateAttachment } from '../attachments';

describe('attachments', () => {
  it('accepts supported files within the server limit', () => {
    expect(validateAttachment({ uri: 'file://photo.jpg', name: 'photo.jpg', size: 2048, mimeType: 'image/jpeg' })).toEqual({
      filename: 'photo.jpg', contentType: 'image/jpeg', byteSize: 2048,
    });
    expect(pendingAttachment({ uri: 'file://notes.txt', name: 'notes.txt', size: 128, mimeType: 'text/plain' })).toMatchObject({
      status: 'queued', progress: 0, image: false,
    });
  });

  it('rejects unsupported, empty, and oversized files', () => {
    expect(() => validateAttachment({ uri: 'file://script.js', name: 'script.js', size: 10, mimeType: 'text/javascript' })).toThrow('not a supported');
    expect(() => validateAttachment({ uri: 'file://empty.txt', name: 'empty.txt', size: 0, mimeType: 'text/plain' })).toThrow('determine the size');
    expect(() => validateAttachment({ uri: 'file://huge.pdf', name: 'huge.pdf', size: 26 * 1024 * 1024, mimeType: 'application/pdf' })).toThrow('25 MB');
  });

  it('formats compact file sizes', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});
