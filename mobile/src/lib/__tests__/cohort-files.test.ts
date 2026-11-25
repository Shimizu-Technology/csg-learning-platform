import { CSV_PREVIEW_LIMITS, ipv6Groups, linkUrlProblem, parseCsv, safeExternalFileUrl } from '@/lib/cohort-files';

test('only public https hosts open or save, like the API', () => {
  for (const url of [
    'https://10.255.0.1/', 'https://172.31.255.255/', 'https://192.168.10.1/', 'https://100.64.0.1/', 'https://100.127.255.254/', 'https://127.1.2.3/',
    'https://169.254.1.1/', 'https://0.1.2.3/', 'https://224.0.0.1/', 'https://[::]/', 'https://[::1]/', 'https://[fc00::1]/', 'https://[fe80::1]/',
    'https://[::ffff:192.168.1.1]/', 'https://[::ffff:6440:1]/', 'https://user:pw@example.com/', 'https://example.com@evil.com/',
    'https://exa%6dple.com/', 'https://bücher.de/', 'https://localhost/', 'https://intranet/', 'https://printer.local/', 'https://2130706433/',
    'https://0x7f.0.0.1/', 'https://0177.0.0.1/', 'https://1.2.3/', 'http://example.com/', 'javascript:alert(1)',
    'https://192.88.99.2/', 'https://[2001::1]/', 'https://[2001:0:4136:e378::1]/', 'https://[2001:2::1]/', 'https://[2001:10::1]/',
    'https://[2001:2f::1]/', 'https://[2001:db8::1]/', 'https://[2002:c000:204::1]/', 'https://[3fff::1]/',
    'https://[0:0:0:0:0:ffff:10.0.0.1]/', 'https://[0000:0000:0000:0000:0000:ffff:0a00:0001]/',
    'https://home.arpa/', 'https://router.home.arpa/', 'https://local/', 'https://internal/', 'https://app.internal/', 'https://LOCALHOST/',
  ]) {
    expect(linkUrlProblem(url)).not.toBeNull();
    expect(safeExternalFileUrl(url)).toBeNull();
  }
  for (const url of ['https://example.com/', 'https://8.8.8.8/', 'https://100.128.0.1/', 'https://172.32.0.1/', 'https://[2001:4860:4860::8888]/', 'https://xn--bcher-kva.de/', 'https://example.com:8443/a?b=1#c',
    'https://[2001:3::1]/', 'https://[2003::1]/', 'https://192.88.100.1/',
    // Fully expanded IPv4-mapped spellings of a public address unwrap like the API's.
    'https://[0:0:0:0:0:ffff:8.8.8.8]/', 'https://[0000:0000:0000:0000:0000:ffff:0808:0808]/']) {
    expect(linkUrlProblem(url)).toBeNull();
    expect(safeExternalFileUrl(url)).toBe(url);
  }
});

test('IPv6 addresses expand the same way in every spelling', () => {
  expect(ipv6Groups('0000:0000:0000:0000:0000:ffff:0808:0808')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x808, 0x808]);
  expect(ipv6Groups('0:0:0:0:0:ffff:8.8.8.8')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x808, 0x808]);
  expect(ipv6Groups('::ffff:8.8.8.8')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x808, 0x808]);
  expect(ipv6Groups('1::2::3')).toBeNull();
  expect(ipv6Groups('1:2:3:4:5:6:7')).toBeNull();
});

test('CSV previews are bounded by rows, columns and cell length', () => {
  const wide = Array.from({ length: 100_000 }, (_, index) => `c${index}`).join(',');
  const { rows, clippedRows, clippedColumns } = parseCsv(`${wide}\n${'x'.repeat(5_000)},b\n`);
  expect(rows[0]).toHaveLength(CSV_PREVIEW_LIMITS.columns);
  expect(rows[1][0]).toBe(`${'x'.repeat(CSV_PREVIEW_LIMITS.cellLength)}…`);
  expect([clippedRows, clippedColumns]).toEqual([false, true]);
  const long = parseCsv(Array.from({ length: 1_000 }, () => 'a').join('\n'));
  expect(long.rows).toHaveLength(CSV_PREVIEW_LIMITS.rows);
  expect(long.clippedRows).toBe(true);
});
