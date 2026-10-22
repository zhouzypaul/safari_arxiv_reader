import test from 'node:test';
import assert from 'node:assert/strict';
import {readPageText} from '../extension/pdf-text.js';

test('extracts all text with a Safari 18 stream without an async iterator', async () => {
  let released = false;
  const chunks = [{items:[{str:'Introduction'}],styles:{a:{fontFamily:'serif'}},lang:'en'}, {items:[{str:'References'}],styles:{b:{fontFamily:'sans-serif'}}}];
  const page = {streamTextContent: () => ({getReader: () => ({
    read: async () => chunks.length ? {value:chunks.shift(),done:false} : {done:true},
    releaseLock: () => {released = true;}
  })})};
  const result = await readPageText(page);
  assert.deepEqual(result.items.map(i=>i.str), ['Introduction','References']);
  assert.deepEqual(Object.keys(result.styles), ['a','b']);
  assert.equal(result.lang, 'en');
  assert.equal(released, true);
});

test('releases the stream when text extraction fails', async () => {
  let released = false;
  const page = {streamTextContent: () => ({getReader: () => ({
    read: async () => {throw Error('bad stream');}, releaseLock: () => {released = true;}
  })})};
  await assert.rejects(readPageText(page), /bad stream/);
  assert.equal(released, true);
});
