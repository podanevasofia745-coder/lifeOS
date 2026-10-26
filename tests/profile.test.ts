import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultProfile,profileSchema} from '../lib/profile';
test('profile validates Moscow and a DST timezone, trims name',()=>{
 for(const timezone of ['Europe/Moscow','Europe/Berlin']){
  const parsed=profileSchema.parse({...defaultProfile,display_name:'  София  ',timezone});
  assert.equal(parsed.display_name,'София');assert.equal(parsed.timezone,timezone);
 }
});
test('invalid timezone, impossible time and out-of-range sleep rejected',()=>{
 for(const patch of [{timezone:'Not/AZone'},{preferred_wake:'25:00'},{preferred_bedtime:'23:90'},{target_sleep_minutes:0},{theme:'neon'},{display_name:'  '}])
  assert.equal(profileSchema.safeParse({...defaultProfile,display_name:'Тест',...patch}).success,false);
});
test('client validation strips server-owned version and identity',()=>{
 const parsed=profileSchema.parse({...defaultProfile,display_name:'Тест',user_id:'other',version:999});
 assert.equal('user_id' in parsed,false);assert.equal('version' in parsed,false);
});
