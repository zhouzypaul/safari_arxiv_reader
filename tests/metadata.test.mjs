import test from 'node:test';import assert from 'node:assert/strict';
import {resolveReference} from '../extension/metadata.js';
import {extractReferences,matchReferences,referenceQuery,identifiers} from '../extension/analysis.js';
test('author-year bibliography uses hanging indentation and family names',()=>{
 const texts=['Sergey Ioffe and Christian Szegedy. Batch normalization: Accelerating deep network training by reducing','internal covariate shift. ICML, 2015.','Ilya Sutskever, Oriol Vinyals, and Quoc V Le. Sequence to sequence learning with neural networks. In','Advances in neural information processing systems, pages 3104–3112, 2014.'];
 const rows=[{text:'References',x:108,page:11,y:700},...texts.map((text,i)=>({text,x:i%2?118:108,page:11,y:680-i*12})),...Array.from({length:4},(_,i)=>({text:'continuation text on an indented line',x:118,page:11,y:620-i*12}))];
 const refs=extractReferences([rows]);assert.equal(refs.length,2);assert.equal(matchReferences('[Ioffe and Szegedy, 2015]',refs)[0].surname,'Ioffe');assert.match(referenceQuery(refs[0].text),/^Batch normalization/);assert.equal(identifiers('CoRR, abs/1409.0473, 2014.').arxiv,'1409.0473');
});
test('automatic metadata selects matching title/year and reconstructs abstract',async()=>{
 const ref={text:'Sepp Hochreiter and Jürgen Schmidhuber. Long short-term memory. Neural computation, 1997.'};let requests=0;
 const fetcher=async()=>{requests++;return {ok:true,text:async()=>JSON.stringify({results:[{title:'Long Short-Term Memory',publication_year:2011},{title:'Long Short-Term Memory',publication_year:1997,authorships:[{author:{display_name:'Sepp Hochreiter'}}],abstract_inverted_index:{Learning:[0],long:[1],dependencies:[2]},doi:'https://doi.org/10.1162/neco.1997.9.8.1735',best_oa_location:{pdf_url:'javascript:bad'}}]})};};
 const result=await resolveReference(ref,fetcher);assert.equal(result[0].year,1997);assert.equal(result[0].abstract,'Learning long dependencies');assert.equal(result[0].pdf,null);await resolveReference(ref,fetcher);assert.equal(requests,1);
});
