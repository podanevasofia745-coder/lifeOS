// Use two dedicated test accounts in a test Supabase project. Never use service-role credentials.
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
const names=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','TEST_USER_A_EMAIL','TEST_USER_A_PASSWORD','TEST_USER_B_EMAIL','TEST_USER_B_PASSWORD'];
if(names.some(n=>!process.env[n])){console.error('RLS test not run: provide URL, public key and two dedicated test-account credentials (see README).');process.exit(2);}
const clients=[0,1].map(()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}));
try{
 const ids=[];
 for(const [i,letter] of ['A','B'].entries()){
  const {data,error}=await clients[i].auth.signInWithPassword({email:process.env[`TEST_USER_${letter}_EMAIL`],password:process.env[`TEST_USER_${letter}_PASSWORD`]});
  assert.equal(error,null,'Test-account sign in failed');ids.push(data.user.id);
 }
 assert.notEqual(ids[0],ids[1]);
 for(const [i,client] of clients.entries()){
  const own=await client.from('profiles').select('*').eq('user_id',ids[i]).single();assert.equal(own.error,null);assert.equal(own.data.user_id,ids[i]);
  const other=await client.from('profiles').select('*').eq('user_id',ids[1-i]);assert.equal(other.error,null);assert.deepEqual(other.data,[]);
  const denied=await client.from('profiles').update({display_name:'RLS must block this'}).eq('user_id',ids[1-i]).select();assert.equal(denied.error,null);assert.deepEqual(denied.data,[]);
  const write=await client.from('profiles').update({display_name:own.data.display_name}).eq('user_id',ids[i]).eq('version',own.data.version).select().single();assert.equal(write.error,null);assert.equal(write.data.version,own.data.version+1);
  const stale=await client.from('profiles').update({display_name:'Stale update'}).eq('user_id',ids[i]).eq('version',own.data.version).select();assert.equal(stale.error,null);assert.deepEqual(stale.data,[]);
 }
 console.log('PASS: own read/write, cross-user isolation, stale-version rejection (two users)');
}finally{await Promise.all(clients.map(c=>c.auth.signOut()));}
