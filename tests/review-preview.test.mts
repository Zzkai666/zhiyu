import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewExcerpt} from '../src/ReviewText.ts';

test('review excerpts show a word boundary and mark omitted context',()=>{
 const text=Array.from({length:55},(_,i)=>'paragraph'+i).join(' ')+'.';
 const tail=reviewExcerpt(text,true),head=reviewExcerpt(text,false);
 assert.match(tail,/^…paragraph[0-9]+ /u);
 assert.match(head,/^paragraph0 /u);
 assert.match(head,/paragraph[0-9]+…$/u);
 assert.equal(reviewExcerpt('Complete sentence.',true),'Complete sentence.');
});
