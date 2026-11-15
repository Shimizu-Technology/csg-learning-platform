import { brand } from '../brand';
it('keeps app display defaults unchanged', () => {
  expect(brand).toMatchObject({ schoolName: 'Code School of Guam', productName: 'CSG Learn', schoolAbbreviation: 'CSG', supportEmail: 'codeschoolofguam@gmail.com', appUrl: 'https://learn.codeschoolofguam.com' });
  expect(brand.logoSvg).toContain('<title>Code School of Guam gear C</title>');
});
it('trims configuration and rejects invalid public URLs', () => {
  const { createBrand } = require('../brand');
  expect(createBrand({ EXPO_PUBLIC_SCHOOL_NAME: ' Example ', EXPO_PUBLIC_APP_URL: ' https://example.org/ ' })).toMatchObject({ schoolName: 'Example', appUrl: 'https://example.org' });
  for (const key of ['EXPO_PUBLIC_SCHOOL_SITE_URL', 'EXPO_PUBLIC_APP_URL']) {
    for (const value of ['invalid', 'http://example.org', 'javascript:alert(1)', 'https://example.org/\n/evil']) {
      expect(() => createBrand({ [key]: value })).toThrow(key);
    }
    expect(() => createBrand({ [key]: '  ' })).not.toThrow();
  }
});
