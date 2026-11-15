import { brand } from '../brand';
it('keeps app display defaults unchanged', () => {
  expect(brand).toMatchObject({ schoolName: 'Code School of Guam', productName: 'CSG Learn', schoolAbbreviation: 'CSG', supportEmail: 'codeschoolofguam@gmail.com', appUrl: 'https://learn.codeschoolofguam.com' });
  expect(brand.logoSvg).toContain('<title>Code School of Guam gear C</title>');
});
