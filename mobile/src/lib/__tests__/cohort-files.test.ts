import { linkUrlProblem, safeExternalFileUrl } from '@/lib/cohort-files';

test('only public https hosts open or save, like the API', () => {
  for (const url of [
    'https://10.255.0.1/', 'https://172.31.255.255/', 'https://192.168.10.1/', 'https://100.64.0.1/', 'https://100.127.255.254/', 'https://127.1.2.3/',
    'https://169.254.1.1/', 'https://0.1.2.3/', 'https://224.0.0.1/', 'https://[::]/', 'https://[::1]/', 'https://[fc00::1]/', 'https://[fe80::1]/',
    'https://[::ffff:192.168.1.1]/', 'https://[::ffff:6440:1]/', 'https://user:pw@example.com/', 'https://example.com@evil.com/',
    'https://exa%6dple.com/', 'https://bücher.de/', 'https://localhost/', 'https://intranet/', 'https://printer.local/', 'https://2130706433/',
    'https://0x7f.0.0.1/', 'https://0177.0.0.1/', 'https://1.2.3/', 'http://example.com/', 'javascript:alert(1)',
  ]) {
    expect(linkUrlProblem(url)).not.toBeNull();
    expect(safeExternalFileUrl(url)).toBeNull();
  }
  for (const url of ['https://example.com/', 'https://8.8.8.8/', 'https://100.128.0.1/', 'https://172.32.0.1/', 'https://[2001:4860:4860::8888]/', 'https://xn--bcher-kva.de/', 'https://example.com:8443/a?b=1#c']) {
    expect(linkUrlProblem(url)).toBeNull();
    expect(safeExternalFileUrl(url)).toBe(url);
  }
});
