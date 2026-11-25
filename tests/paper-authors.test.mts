import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAuthors } from '../src/PaperAuthors.ts';

test('arXiv family and given pairs stay together when a long old list is collapsed', () => {
  const raw='Brohan, Anthony, Brown, Noah, Carbajal, Justice, Chebotar, Yevgen, Chen, Xi';
  const summary=summarizeAuthors(raw);
  assert.equal(summary.preview,'Brohan, Anthony；Brown, Noah；Carbajal, Justice');
  assert.equal(summary.remaining,2);
  assert.equal(summary.full,raw);
});

test('Crossref full names and explicitly separated profiles show three whole entries', () => {
  const normal=summarizeAuthors('Ada Lovelace, Alan Turing, Grace Hopper, Barbara Liskov');
  assert.equal(normal.preview,'Ada Lovelace；Alan Turing；Grace Hopper');
  assert.equal(normal.remaining,1);
  const separate=summarizeAuthors('Smith, Ada; Lee, Kyung; Müller, A. J.; 李华，王强');
  assert.equal(separate.preview,'Smith, Ada；Lee, Kyung；Müller, A. J.');
  assert.equal(separate.remaining,1);
});

test('short and missing author lists do not gain an expand control', () => {
  assert.equal(summarizeAuthors('李华、王强').expandable,false);
  assert.equal(summarizeAuthors('Brohan, Anthony').expandable,false);
  assert.equal(summarizeAuthors('').preview,'作者待补充');
});

test('ambiguous mixed lists retain raw text and avoid a misleading count', () => {
  const raw='A. Researcher, Consortium of Neural Robotics, Project R2-D2, Daniel, J.';
  const summary=summarizeAuthors(raw);
  assert.equal(summary.clamp,true);
  assert.equal(summary.remaining,0);
  assert.equal(summary.full,raw);
});