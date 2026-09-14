#!/usr/bin/env python3
"""Signup diagnosis; optional exact synthetic-record verification and cleanup."""
import json
import os
from pathlib import Path
import sys
import tempfile
from deploy import selected_kubeconfig, kube, failure_message

PROBE = r"""
const {MongoClient} = require('mongodb');
(async () => {
 const uri = process.env.MONGODB_URI;
 console.log(JSON.stringify({mongodbConfigured:!!uri,originMatches:process.env.SIGNUP_ALLOWED_ORIGIN==='https://elementafestival.com'}));
 if(!uri) return;
 // Same configured credentials and server, at most three known auth databases.
 // Never try passwords, retarget a server, change users or mutate records.
 const attempts = process.argv[1] === 'verify' ? [process.env.MONGODB_AUTH_SOURCE || undefined] : [process.env.MONGODB_AUTH_SOURCE || undefined, 'admin', 'elementa'];
 const seen = new Set();
 for (const authSource of attempts) {
  let client;
  let authenticationFailed = false;
  const label = authSource || 'configured';
  try {
   client = new MongoClient(uri,{...(authSource ? {authSource} : {}),serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,socketTimeoutMS:5000});
   const effective = client.options.credentials?.source;
   if (seen.has(effective)) continue;
   seen.add(effective);
   console.log(JSON.stringify({attempt:label,authSource:['admin','elementa'].includes(effective)?effective:'other',credentialsPresent:!!client.options.credentials}));
   await client.connect();
   await client.db('elementa').command({ping:1});
   await client.db('elementa').collection('subscribers').findOne({_id:'elementa-issue21-qa@example.invalid'},{projection:{_id:1},maxTimeMS:5000});
   console.log(JSON.stringify({attempt:label,connection:'ok',subscriberRead:'ok'}));
   if (process.argv[1] === 'verify') {
    const collection = client.db('elementa').collection('subscribers');
    const id = 'elementa-issue21-qa@example.invalid';
    const record = await collection.findOne({_id:id},{maxTimeMS:5000});
    const valid = record && record.email === id && record.consent === true &&
     ['en','es'].includes(record.locale) && record.consentVersion === 'elementa-updates-promotions-v2' &&
     record.createdAt instanceof Date && record.createdAt.getTime() > Date.now()-86400000;
    if (!valid || await collection.countDocuments({_id:id},{maxTimeMS:5000}) !== 1) {
     console.log('synthetic_record_verification_failed'); process.exitCode=1; break;
    }
    const deleted = await collection.deleteOne({_id:id,email:id,createdAt:record.createdAt,consentVersion:record.consentVersion});
    const absent = await collection.countDocuments({_id:id},{maxTimeMS:5000}) === 0;
    console.log(JSON.stringify({syntheticRecordVerified:true,uniqueRecord:true,syntheticRecordRemoved:deleted.acknowledged && deleted.deletedCount===1 && absent}));
    if (!deleted.acknowledged || deleted.deletedCount!==1 || !absent) process.exitCode=1;
   }
   break;
  } catch(e) {
   if (process.argv[1] === 'verify') process.exitCode=1;
   authenticationFailed = e.code===18;
   const names=['MongoServerError','MongoServerSelectionError','MongoParseError','MongoNetworkError','MongoNetworkTimeoutError'];
   console.log(JSON.stringify({attempt:label,error:names.includes(e.name)?e.name:'unclassified',code:Number.isInteger(e.code)?e.code:null,authenticationFailed,unauthorized:e.code===13}));
  } finally { if(client) await client.close(); }
  if (!authenticationFailed) break;
 }
})().catch(()=>{console.log('probe_failed');process.exitCode=1;});
"""

def inspect():
    with tempfile.TemporaryDirectory(prefix='elementa-signup-') as directory:
        with selected_kubeconfig(Path(directory), os.environ['LINODE_KUBECONFIG']):
            pods = json.loads(kube('get','pods','-l','app.kubernetes.io/instance=elementa','-o','json'))
            for pod in pods['items']:
                if pod.get('status',{}).get('phase') != 'Running':
                    continue
                print('SIGNUP_PROBE ' + kube('exec',pod['metadata']['name'],'--','node','-e',PROBE,'verify' if os.environ.get('VERIFY_SIGNUP') == 'true' else 'inspect'),flush=True)
                if os.environ.get('VERIFY_SIGNUP') == 'true':
                    return  # Shared test record: verify/cleanup through one replica only.

if __name__ == '__main__':
    try:
        inspect()
    except Exception as error:
        print('Signup inspection FAILED: '+failure_message(error),file=sys.stderr)
        sys.exit(1)
