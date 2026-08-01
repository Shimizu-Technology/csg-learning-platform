import { messagePreview, normalizeMessageLink, parseMessageBlocks, plainMessageText, splitTrailingUrlPunctuation } from '../message-format';

describe('message formatting', () => {
  it('groups paragraphs, lists, quotes, and fenced code like the web renderer', () => {
    expect(parseMessageBlocks('Intro\n\n- First\n- Second\n\n> Note\n\n```sh\nls - list\n```')).toEqual([
      { type: 'paragraph', text: 'Intro' },
      { type: 'spacer' },
      { type: 'bulletList', items: ['First', 'Second'] },
      { type: 'spacer' },
      { type: 'blockquote', text: 'Note' },
      { type: 'code', language: 'sh', code: 'ls - list' },
    ]);
  });

  it('keeps an unfinished fence readable without exposing its marker', () => {
    expect(parseMessageBlocks('```\nmkdir project')).toEqual([
      { type: 'code', language: '', code: 'mkdir project' },
    ]);
  });

  it('turns formatted messages into clean inbox and search text', () => {
    const body = '```sh\nls - list\n```\n\n- **Open** [the guide](https://example.com)\n> Then run `pwd`';
    expect(plainMessageText(body)).toBe('ls - list Open the guide Then run pwd');
    expect(messagePreview(body, 24)).toBe('ls - list Open the gu...');
  });

  it('uses a useful fallback for attachment-only content', () => {
    expect(messagePreview('', 80, 'layout.png')).toBe('layout.png');
  });

  it('does not leak incomplete inline-code markers into previews', () => {
    expect(plainMessageText('Run `bundle install when setup starts')).toBe('Run bundle install when setup starts');
  });

  it('allows web and email links while rejecting unsafe or file-like values', () => {
    expect(normalizeMessageLink('www.codeschoolofguam.com')).toBe('https://www.codeschoolofguam.com/');
    expect(normalizeMessageLink('hello@example.com')).toBeNull();
    expect(normalizeMessageLink('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(normalizeMessageLink('javascript:alert(1)')).toBeNull();
    expect(normalizeMessageLink('lesson.ts')).toBeNull();
  });

  it('keeps punctuation outside automatically linked URLs', () => {
    expect(splitTrailingUrlPunctuation('https://example.com/help).')).toEqual({
      href: 'https://example.com/help',
      trailing: ').',
    });
  });
});
