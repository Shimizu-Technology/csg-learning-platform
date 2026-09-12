/** @jest-environment jsdom */

import { URL as NodeUrl } from 'node:url';

import { richTextEditorDocument } from '../rich-text-editor';

describe('rich text editor browser bridge', () => {
  it('sanitizes hostile imported and pasted markup before emitting it', () => {
    jest.useFakeTimers();
    const documentHtml = richTextEditorDocument('<p onclick="steal()">Safe</p></script><script>alert(1)</script>', 'Write clearly');
    const bridgeScript = documentHtml.match(/<script>([\s\S]*)<\/script>/)?.[1];
    if (!bridgeScript) throw new Error('Expected the editor bridge script');

    const postMessage = jest.fn();
    const editor = document.createElement('div');
    editor.id = 'editor';
    editor.contentEditable = 'true';
    document.body.replaceChildren(editor);
    Object.defineProperty(window, 'ReactNativeWebView', { configurable: true, value: { postMessage } });
    Object.defineProperty(window, 'URL', { configurable: true, value: NodeUrl });
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class { observe() { /* Test-only layout observer. */ } },
    });
    Object.defineProperty(document, 'queryCommandState', { configurable: true, value: () => false });
    Object.defineProperty(document, 'queryCommandEnabled', { configurable: true, value: () => false });
    const execCommand = jest.fn((command: string, _showUi?: boolean, commandValue?: string) => {
      if (command === 'insertHTML') editor.insertAdjacentHTML('beforeend', commandValue || '');
      if (command === 'insertText') editor.append(commandValue || '');
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    window.eval(bridgeScript);
    expect(editor.innerHTML).toBe('<p>Safe</p>');
    postMessage.mockClear();

    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (type: string) => type === 'text/html'
          ? '<img src="http://example.com/insecure.png" onerror="steal()"><a href="javascript:steal()">Bad</a><strong style="color:red">Good</strong><iframe src="https://example.com"></iframe>'
          : '',
      },
    });
    editor.dispatchEvent(paste);
    jest.runOnlyPendingTimers();

    const messages = postMessage.mock.calls.map(([payload]) => JSON.parse(payload));
    expect(messages).toContainEqual({ type: 'content', html: '<p>Safe</p><a>Bad</a><strong>Good</strong>' });

    const bridge = (window as typeof window & { CSGEditor: { command: (command: string, value: string) => void } }).CSGEditor;
    const createLinkCallsBefore = execCommand.mock.calls.filter(([command]) => command === 'createLink').length;
    bridge.command('setLink', 'javascript:steal()');
    const createLinkCallsAfter = execCommand.mock.calls.filter(([command]) => command === 'createLink').length;
    expect(createLinkCallsAfter).toBe(createLinkCallsBefore);
    jest.useRealTimers();
  });
});
