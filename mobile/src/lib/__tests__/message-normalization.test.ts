import { messageBodyForSend } from '../code-paste';
it('preserves code and HTML blank lines and cleans only prose blank lines and empty markers', () => {
  const body = '\n    a\n\n\n    b\n\n-\n\ntext\n\n\nend  ';
  expect(messageBodyForSend(body)).toBe('    a\n\n\n    b\n\n\ntext\n\nend  ');
  expect(messageBodyForSend('<pre>\n\n\n</pre>')).toBe('<pre>\n\n\n</pre>');
});
