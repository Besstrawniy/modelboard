import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usesPasswordAuth, configuredAccount, serverJwtSecret, validateAuthConfiguration } from '../packages/shared/src/serverAuth.ts';

const env={NODE_ENV:'production',JWT_SECRET:'a'.repeat(40),OWNER_PASSWORD:'owner-secret-012345',EDITOR_PASSWORD:'editor-secret-012345'};
test('production always requires credentials, even with a demo override',()=>{
  assert.equal(usesPasswordAuth({...env,AUTH_MODE:'demo'}),true);
  assert.equal(usesPasswordAuth({}),false);
  assert.equal(usesPasswordAuth({AUTH_MODE:'password'}),true);
  assert.throws(()=>validateAuthConfiguration({...env,OWNER_PASSWORD:''}),/OWNER_PASSWORD/);
  assert.throws(()=>validateAuthConfiguration({...env,JWT_SECRET:'short'}),/JWT_SECRET/);
  assert.throws(()=>validateAuthConfiguration({...env,EDITOR_PASSWORD:'short'}),/EDITOR_PASSWORD/);
});
test('credentials identify an account; missing credentials and disabled accounts cannot log in',()=>{
  assert.equal(configuredAccount(' OWNER@example.local ',env.OWNER_PASSWORD,env)?.id,'10000000-0000-0000-0000-000000000001');
  assert.equal(configuredAccount('editor@example.local',env.EDITOR_PASSWORD,env)?.id,'10000000-0000-0000-0000-000000000002');
  for(const [email,password] of [['owner@example.local','wrong'],['editor@example.local',env.OWNER_PASSWORD],['viewer@example.local',''],['unknown@example.local',env.OWNER_PASSWORD],[null,{}]])
    assert.equal(configuredAccount(email,password,env),null);
  assert.equal(configuredAccount('owner@example.local',env.OWNER_PASSWORD,{}),null);
});
test('server tokens have a different key from demo and credential changes invalidate sessions',()=>{
  const key=serverJwtSecret(env);
  assert.equal(key,serverJwtSecret({...env}));
  assert.notEqual(key,env.JWT_SECRET);
  assert.notEqual(key,serverJwtSecret({...env,OWNER_PASSWORD:'new-owner-secret-012345'}));
  assert.notEqual(key,serverJwtSecret({...env,EDITOR_PASSWORD:''}));
  assert.equal(serverJwtSecret({JWT_SECRET:env.JWT_SECRET}),env.JWT_SECRET);
});
