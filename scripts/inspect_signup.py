#!/usr/bin/env python3
"""Bounded read-only signup authentication diagnosis; no credentials in output."""
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
 const attempts = [undefined, 'admin', 'elementa'];
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
   break;
  } catch(e) {
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
                print('SIGNUP_PROBE ' + kube('exec',pod['metadata']['name'],'--','node','-e',PROBE),flush=True)

if __name__ == '__main__':
    try:
        inspect()
    except Exception as error:
        print('Signup inspection FAILED: '+failure_message(error),file=sys.stderr)
        sys.exit(1)
