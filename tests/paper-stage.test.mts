import test from'node:test';import assert from'node:assert/strict';import{translationStage}from'../src/paper-stage.ts';
const summary={revision:1,pending:0,confirmed:0,total:40,saved:40};
test('old saved translations need no new job to show completion',()=>{assert.deepEqual(translationStage(summary,undefined,true),{complete:true,progress:100,label:'已完成',state:'done'})});
test('a completed page job cannot claim full paper completion',()=>{const s=translationStage({...summary,saved:8},{state:'done',done:8,total:8},true);assert.equal(s.progress,20);assert.equal(s.label,'待补译');assert.equal(s.complete,false)});
test('resumed batch counts already saved paragraphs in whole paper',()=>{const s=translationStage({...summary,saved:24},{state:'running',done:4,total:20},true);assert.equal(s.progress,60);assert.equal(s.label,'24 / 40 段')});
test('paused and failed jobs preserve saved coverage',()=>{for(const state of ['paused','failed']){const s=translationStage({...summary,saved:20},{state,done:0,total:20},true);assert.equal(s.progress,50);assert.equal(s.state,state)}});
test('unsummarized task does not fabricate full paper completion',()=>{const s=translationStage(undefined,{state:'done',done:10,total:10},true);assert.equal(s.complete,false);assert.equal(s.label,'待补译')});
