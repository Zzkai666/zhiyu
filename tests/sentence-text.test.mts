import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sentenceBounds} from '../src/SentenceText.ts';
test('sentence hover spans wrapped text and preserves scientific abbreviations and decimals',()=>{
 const text='Smith et al. [2] report results in Fig. 3 with a score of 0.95. The next sentence begins here. 最后一句。';
 const parts=sentenceBounds(text).map(part=>text.slice(part.start,part.end).trim());
 assert.equal(parts[0],'Smith et al. [2] report results in Fig. 3 with a score of 0.95.');
 assert.equal(parts[1],'The next sentence begins here.');
 assert.equal(parts[2],'最后一句。');
});
