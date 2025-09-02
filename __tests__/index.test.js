import { render } from '../src/index.js';

describe('SebastianJS', () => {
  it('should render a basic flowchart', async () => {
    const definition = 'graph TD; A-->B;';
    const svg = await render(definition);
    expect(svg).toContain('<svg');
    expect(svg).toContain('A');
    expect(svg).toContain('B');
  });
});
