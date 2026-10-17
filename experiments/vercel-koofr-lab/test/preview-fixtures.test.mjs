import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {backend} from './helpers/collection.mjs';
import {NoteStore} from '../lib/store.mjs';
import {previewFixture} from '../lib/preview-fixtures.mjs';
for(const stage of ['restore-empty','restore-marker-loss','restore-catalog-loss','restore-catalog-verify-loss','restore-unowned','restore-mkcol-loss','restore-partial','api-owner','api-sharing','prepare-browser-preview'])test('preview qualification: '+stage,async()=>{
 const b=backend(),input={user:'fake',password:'synthetic-secret',namespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID(),sourceNamespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID(),stage},makeStore=(x,opts={})=>new NoteStore(x,{makeDav:b.makeDav,wire:b.wire,...opts});const r=await previewFixture(input,{makeStore,wire:b.wire});assert.equal(r.passed,true,JSON.stringify(r.errors));assert.ok(!JSON.stringify(r).includes('synthetic-secret'));assert.ok(!/[a-f0-9]{32}\.[a-f0-9]{64}/.test(JSON.stringify(r)));assert.equal(b.locks.size,0);
});
