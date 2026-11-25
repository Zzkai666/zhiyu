import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeBlocks, layoutBlocks, type Glyph } from '../src/layout.ts';

const glyph = (text: string, x: number, y: number, w: number, h: number, baseline: number, end = false): Glyph =>
  ({ text, rect: { x, y, w, h }, height: h, baseline, end });

test('preserves native symbols and recognizes small raised or lowered digits', () => {
  const blocks = nativeBlocks([
    glyph('α',.1,.10,.01,.02,.12),
    glyph('2',.111,.098,.008,.01,.109),
    glyph(' + β',.12,.10,.03,.02,.12),
    glyph('1',.151,.117,.008,.01,.126,true),
  ]);
  assert.equal(blocks[0].text,'α² + β₁');
});

test('keeps overlapping prose and exposes table as a crop without table text', () => {
  const blocks = layoutBlocks([
    glyph('readable', .54,.30,.1,.02,.32),
    glyph('cell text', .11,.32,.08,.02,.34),
  ], [
    { kind:'table', score:.85, rect:{ x:.09,y:.24,w:.58,h:.24 } },
    { kind:'text', score:.8, rect:{ x:.52,y:.28,w:.20,h:.10 } },
  ]);
  assert.equal(blocks[0].kind,'table');
  assert.equal(blocks[0].text,'');
  assert.equal(blocks[0].uncertain,true);
  assert.equal(blocks[1].text,'readable');
});

test('preserves unmatched text for review and flags private-use glyphs', () => {
  const blocks = layoutBlocks([glyph('ξ \uE100', .1,.3,.1,.02,.32)], []);
  assert.equal(blocks[0].uncertain,true);
  assert.equal(blocks[0].text,'ξ \uE100');
});
